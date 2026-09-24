import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import ejs from 'ejs'
import { getRealmIndex } from './blizzard'
import { checkCharacters, isDone, progressOf, type CharCheck } from './folio'

// Checks folio progress for every raider in raiders.json (built by
// src/raiders.ts from Warcraft Logs data), saves the day's results to
// data/<date>.json and rebuilds site/index.html from every stored snapshot.
// Run nightly by the GitHub Actions workflow.

interface RaiderGuild {
  guild: string
  server: string
  raiders: { name: string; server: string; reports: number; pulls: number }[]
}

type RaiderResult = CharCheck & { name: string; realm: string; pulls: number }

const MIN_BOSSES = 4

// snapshots from before The Venomous Abyss have no tier and were gated on L'ura
const TIERS = {
  lura: { boss: "L'ura", gate: "a mythic L'ura kill" },
  abyss: { boss: "Ula'tek", gate: `${MIN_BOSSES} or more mythic Venomous Abyss bosses down` },
}
type Tier = keyof typeof TIERS

interface DaySnapshot {
  date: string
  tier?: Tier
  // only raiders with a mythic end boss kill were kept
  bossOnly?: boolean
  guilds: { guild: string; server: string; firstKill?: string; results: RaiderResult[] }[]
}

// the guild's first kill night: earliest day at least two raiders earned the
// achievement on, so a transfer bringing an older personal date does not skew it
function firstKillDay(results: RaiderResult[]): string | undefined {
  const days = results
    .filter(r => r.ulatekWhen)
    .map(r => new Date(r.ulatekWhen!).toISOString().slice(0, 10))
    .sort()
  const shared = days.find((d, i) => days[i + 1] === d)
  return shared ?? days[0]
}

const bossOnly = process.argv.includes('--ulatek')

// WCL spells servers its own way (ShatteredHand, Tarren Mill...), Blizzard's
// realm index is the authority on slugs, so match through a squashed form
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const realmSlugs = new Map<string, string>()
for (const r of (await getRealmIndex()).realms) {
  realmSlugs.set(squash(r.name), r.slug)
  realmSlugs.set(squash(r.slug), r.slug)
}
const resolveRealm = (server: string) =>
  realmSlugs.get(squash(server)) ?? server.toLowerCase().replace(/\s+/g, '-')

const raiderGuilds: RaiderGuild[] = JSON.parse(await readFile('raiders.json', 'utf8'))
const guilds: DaySnapshot['guilds'] = []
for (const g of raiderGuilds) {
  const targets = g.raiders.map(r => ({ name: r.name, realm: resolveRealm(r.server), pulls: r.pulls }))
  let results: RaiderResult[] = await checkCharacters(targets)
  // two raiders so one transfer with kills from another guild does not count
  if (results.filter(r => r.bossKills >= MIN_BOSSES).length < 2) {
    console.log(`${g.guild} (${g.server}): under ${MIN_BOSSES} mythic bosses, left out`)
    continue
  }
  if (bossOnly) results = results.filter(r => r.ulatekKill)
  const behind = results.filter(r => !isDone(r)).length
  console.log(`${g.guild} (${g.server}): ${results.length} raiders, ${behind} behind`)
  guilds.push({ guild: g.guild, server: g.server, firstKill: firstKillDay(results), results })
}

const date = new Date().toISOString().slice(0, 10)
const snapshot: DaySnapshot = { date, tier: 'abyss', bossOnly, guilds }
await mkdir('data', { recursive: true })
await writeFile(`data/${date}.json`, JSON.stringify(snapshot))
console.log(`saved data/${date}.json`)

// every stored day gets its own page, index.html is a copy of the newest
const files = (await readdir('data')).filter(f => f.endsWith('.json')).sort()
const snaps: DaySnapshot[] = []
for (const f of files) {
  snaps.push(JSON.parse(await readFile(`data/${f}`, 'utf8')))
}

// first kill dates are history, show the freshest known value on every day
const knownFirst = new Map<string, string>()
for (const s of snaps) {
  for (const g of s.guilds) {
    if (g.firstKill) knownFirst.set(`${s.tier}|${g.guild} (${g.server})`, g.firstKill)
  }
}

await mkdir('site', { recursive: true })
for (let i = 0; i < snaps.length; i++) {
  const d = snaps[i]
  // folio weeks per raider on the previous stored day, for progress deltas
  const prevWeeks = new Map<string, number>()
  if (i > 0) {
    for (const g of snaps[i - 1].guilds) {
      for (const r of g.results) {
        if (!r.error) prevWeeks.set(`${r.name}|${r.realm}`, r.weeks)
      }
    }
  }

  const dayGuilds = d.guilds.map(g => {
    const finished: string[] = []
    const missing = []
    for (const r of g.results) {
      const before = prevWeeks.get(`${r.name}|${r.realm}`)
      if (isDone(r)) {
        if (before != null && before < 5) finished.push(r.name)
        continue
      }
      missing.push({
        name: r.name,
        realm: r.realm,
        pulls: r.pulls,
        ...progressOf(r),
        upFrom: before != null && !r.error && r.weeks > before ? before : null,
      })
    }
    return {
      label: `${g.guild} (${g.server})`,
      firstKill: knownFirst.get(`${d.tier}|${g.guild} (${g.server})`),
      total: g.results.length,
      finished,
      improved: missing.filter(m => m.upFrom != null).length,
      missing,
    }
  })

  const day = {
    date: d.date,
    prevDate: i > 0 ? snaps[i - 1].date : null,
    tier: TIERS[d.tier ?? 'lura'],
    bossOnly: d.bossOnly === true,
    total: dayGuilds.reduce((n, g) => n + g.total, 0),
    missingCount: dayGuilds.reduce((n, g) => n + g.missing.length, 0),
    finishedCount: dayGuilds.reduce((n, g) => n + g.finished.length, 0),
    guilds: dayGuilds,
  }
  const html = await ejs.renderFile('templates/site.ejs', {
    day,
    older: i > 0 ? snaps[i - 1].date : null,
    newer: i < snaps.length - 1 ? snaps[i + 1].date : null,
  })
  await writeFile(`site/${d.date}.html`, html)
  if (i === snaps.length - 1) await writeFile('site/index.html', html)
}
console.log(`built site/ with ${snaps.length} day page${snaps.length === 1 ? '' : 's'}`)
