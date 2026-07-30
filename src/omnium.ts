import { writeFile } from 'node:fs/promises'
import ejs from 'ejs'
import { getGuildRoster } from './blizzard'
import { checkCharacters, isDone, progressOf } from './folio'

const wantHtml = process.argv.includes('--html')
const luraOnly = process.argv.includes('--lura')
const [realm, guildSlug, rankArg] = process.argv.slice(2).filter(a => !a.startsWith('--'))

if (!realm || !guildSlug || !rankArg) {
  console.log('Usage: bun src/omnium.ts <realm-slug> <guild-slug> <rank-number-or-character> [--html] [--lura]')
  console.log('Example: bun src/omnium.ts sylvanas beyond-harmless velvets')
  console.log('Reports Omnium Folio progress for every member at that rank or above.')
  console.log("With --lura only members with a mythic L'ura kill are counted.")
  console.log('With --html also writes the slackers to a timestamped report-*.html.')
  process.exit(1)
}

const roster = (await getGuildRoster(realm, guildSlug)).members

let maxRank: number
if (/^\d+$/.test(rankArg)) {
  maxRank = Number(rankArg)
} else {
  const member = roster.find(m => m.character.name.toLowerCase() === rankArg.toLowerCase())
  if (!member) {
    console.error(`${rankArg} is not in the roster of ${guildSlug}`)
    process.exit(1)
  }
  maxRank = member.rank
  console.log(`${member.character.name} is rank ${maxRank}, checking rank ${maxRank} and above`)
}

const targets = roster
  .filter(m => m.rank <= maxRank)
  .map(m => ({ name: m.character.name, realm: m.character.realm.slug, rank: m.rank }))
console.log(`${targets.length} members to check\n`)

let results = await checkCharacters(targets)
if (luraOnly) {
  results = results.filter(r => r.luraKill)
  console.log(`${results.length} of them have the mythic L'ura kill\n`)
}
results.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))

for (const r of results) {
  let status
  if (r.error) status = 'no profile data'
  else if (isDone(r)) status = 'done (5/5)'
  else if (!r.unlocked) status = `SLACKING, folio not unlocked (${r.weeks}/5)`
  else status = `SLACKING, ${r.weeks}/5 weeks`
  console.log(`rank ${r.rank}  ${r.name.padEnd(14)} ${status}`)
}

if (wantHtml) {
  const missing = results.filter(r => !isDone(r)).map(r => ({
    name: r.name,
    realm: r.realm,
    rank: r.rank,
    ...progressOf(r),
  }))

  const html = await ejs.renderFile('templates/report.ejs', {
    guildSlug,
    realm,
    maxRank,
    luraOnly,
    total: results.length,
    missing,
  })
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '')
  const outFile = `report-${stamp}.html`
  await writeFile(outFile, html)
  console.log(`\nWrote ${missing.length} entries to ${outFile}`)
}
