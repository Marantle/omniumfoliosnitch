import { getCharacterProfile } from './blizzard'

// subresources from the profile API docs, plain profile when omitted
const KNOWN = [
  'achievements',
  'appearance',
  'collections',
  'encounters',
  'equipment',
  'hunter-pets',
  'media',
  'mythic-keystone-profile',
  'professions',
  'pvp-summary',
  'quests',
  'reputations',
  'specializations',
  'statistics',
  'titles',
]

const [realm, name, subresource] = process.argv.slice(2)

if (!realm || !name) {
  console.log('Usage: bun src/index.ts <realm-slug> <character-name> [subresource]')
  console.log('Example: bun src/index.ts draenor thrall equipment')
  console.log(`Subresources: ${KNOWN.join(', ')}`)
  process.exit(1)
}

if (subresource && !KNOWN.includes(subresource)) {
  console.log(`Unknown subresource "${subresource}", trying it anyway...`)
}

try {
  const data = await getCharacterProfile(realm, name, subresource)
  console.log(JSON.stringify(data, null, 2))
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
