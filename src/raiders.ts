import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { wclQuery } from './wcl'

// Crawls Warcraft Logs for every guild in tracked-guilds.json and writes
// raiders.json: the characters who actually show up in the guild's mythic
// reports. Report fight data is cached in cache/ because old reports never
// change, so only new reports cost points on later runs.

const ZONES = [50, 46]
const MIN_REPORTS = 3
const MIN_PULLS = 40

interface TrackedGuild {
  guild: string
  server: string
}

interface ReportListData {
  reportData: {
    reports: {
      has_more_pages: boolean
      data: { code: string }[]
    }
  }
}

interface ReportFights {
  fights: { id: number; friendlyPlayers: number[] | null }[]
  actors: { id: number; name: string; server: string | null }[]
}

interface ReportDetailData {
  reportData: {
    report: {
      fights: { id: number; friendlyPlayers: number[] | null }[]
      masterData: { actors: { id: number; name: string; server: string | null }[] }
    }
  }
}

const REPORTS_QUERY = `
query ($guildName: String!, $serverSlug: String!, $serverRegion: String!, $zoneID: Int!, $page: Int!) {
  reportData {
    reports(guildName: $guildName, guildServerSlug: $serverSlug, guildServerRegion: $serverRegion, zoneID: $zoneID, page: $page) {
      has_more_pages
      data { code }
    }
  }
}`

const REPORT_QUERY = `
query ($code: String!) {
  reportData {
    report(code: $code) {
      fights(difficulty: 5) { id friendlyPlayers }
      masterData { actors(type: "Player") { id name server } }
    }
  }
}`

export function realmSlug(server: string): string {
  return server.toLowerCase().replace(/['.]/g, '').replace(/\s+/g, '-')
}

async function guildReportCodes(g: TrackedGuild): Promise<string[]> {
  const codes: string[] = []
  for (const zoneID of ZONES) {
    for (let page = 1; ; page++) {
      const data = await wclQuery<ReportListData>(REPORTS_QUERY, {
        guildName: g.guild,
        serverSlug: realmSlug(g.server),
        serverRegion: 'eu',
        zoneID,
        page,
      })
      const reports = data.reportData.reports
      codes.push(...reports.data.map(r => r.code))
      if (!reports.has_more_pages) break
    }
  }
  return codes
}

async function reportFights(code: string): Promise<ReportFights> {
  const cacheFile = `cache/${code}.json`
  try {
    return JSON.parse(await readFile(cacheFile, 'utf8'))
  } catch {
    const data = await wclQuery<ReportDetailData>(REPORT_QUERY, { code })
    const report: ReportFights = {
      fights: data.reportData.report.fights,
      actors: data.reportData.report.masterData.actors,
    }
    await writeFile(cacheFile, JSON.stringify(report))
    return report
  }
}

interface CharStat {
  name: string
  server: string
  reports: number
  pulls: number
  byGuild: Map<string, { reports: number; pulls: number }>
}

const onlyIdx = process.argv.indexOf('--only')
const only = onlyIdx === -1 ? null : process.argv[onlyIdx + 1]?.toLowerCase()

let guilds: TrackedGuild[] = JSON.parse(await readFile('tracked-guilds.json', 'utf8'))
if (only) {
  guilds = guilds.filter(g => g.guild.toLowerCase().includes(only))
}
await mkdir('cache', { recursive: true })

const chars = new Map<string, CharStat>()

for (const g of guilds) {
  const guildKey = `${g.guild}|${g.server}`
  let codes: string[]
  try {
    codes = await guildReportCodes(g)
  } catch (e) {
    console.log(`skipping ${g.guild} (${g.server}): ${e instanceof Error ? e.message : e}`)
    continue
  }

  let mythicReports = 0
  for (const code of codes) {
    let rep: ReportFights
    try {
      rep = await reportFights(code)
    } catch (e) {
      console.log(`  skipping report ${code}: ${e instanceof Error ? e.message : e}`)
      continue
    }
    if (!rep.fights.length) continue
    mythicReports++

    const actorById = new Map(rep.actors.map(a => [a.id, a]))
    const pullsByActor = new Map<number, number>()
    for (const fight of rep.fights) {
      for (const id of fight.friendlyPlayers ?? []) {
        pullsByActor.set(id, (pullsByActor.get(id) ?? 0) + 1)
      }
    }

    for (const [id, pulls] of pullsByActor) {
      const actor = actorById.get(id)
      if (!actor?.server) continue
      const key = `${actor.name.toLowerCase()}|${actor.server.toLowerCase()}`
      let stat = chars.get(key)
      if (!stat) {
        stat = { name: actor.name, server: actor.server, reports: 0, pulls: 0, byGuild: new Map() }
        chars.set(key, stat)
      }
      stat.reports++
      stat.pulls += pulls
      const gs = stat.byGuild.get(guildKey) ?? { reports: 0, pulls: 0 }
      gs.reports++
      gs.pulls += pulls
      stat.byGuild.set(guildKey, gs)
    }
  }
  console.log(`${g.guild} (${g.server}): ${codes.length} reports, ${mythicReports} with mythic fights`)
}

// attribute each raider to the guild whose logs they appear in most
const raidersByGuild = new Map<string, { name: string; server: string; reports: number; pulls: number }[]>()
for (const stat of chars.values()) {
  if (stat.reports < MIN_REPORTS || stat.pulls < MIN_PULLS) continue
  let topGuild = ''
  let top = { reports: 0, pulls: 0 }
  for (const [guildKey, gs] of stat.byGuild) {
    if (gs.reports > top.reports || (gs.reports === top.reports && gs.pulls > top.pulls)) {
      topGuild = guildKey
      top = gs
    }
  }
  const list = raidersByGuild.get(topGuild) ?? []
  list.push({
    name: stat.name,
    server: stat.server,
    reports: stat.reports,
    pulls: stat.pulls,
  })
  raidersByGuild.set(topGuild, list)
}

const out = guilds
  .filter(g => raidersByGuild.has(`${g.guild}|${g.server}`))
  .map(g => ({
    guild: g.guild,
    server: g.server,
    raiders: raidersByGuild.get(`${g.guild}|${g.server}`)!.sort((a, b) => b.pulls - a.pulls),
  }))

await writeFile('raiders.json', JSON.stringify(out, null, 2))
const totalRaiders = out.reduce((n, g) => n + g.raiders.length, 0)
console.log(`\nwrote raiders.json: ${totalRaiders} raiders in ${out.length} guilds`)
