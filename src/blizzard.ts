const OAUTH_URL = 'https://oauth.battle.net/token'
const API_HOST = 'https://eu.api.blizzard.com'
const NAMESPACE = 'profile-eu'
const LOCALE = 'en_GB'

export interface CharacterProfile {
  name: string
  level: number
  average_item_level: number
  character_class: { name: string }
  active_spec?: { name: string }
  guild?: { name: string; realm: { slug: string } }
}

export interface CharacterAchievement {
  id: number
  criteria?: { amount?: number; is_completed?: boolean }
}

export interface AchievementsSummary {
  achievements: CharacterAchievement[]
}

export interface GuildMember {
  character: { name: string; realm: { slug: string }; level?: number }
  rank: number
}

export interface GuildRoster {
  members: GuildMember[]
}

let token: string | null = null
let tokenExpiry = 0

async function getToken(): Promise<string> {
  if (token && Date.now() < tokenExpiry) return token

  const id = process.env.BNET_CLIENT_ID
  const secret = process.env.BNET_CLIENT_SECRET
  if (!id || !secret) {
    throw new Error('BNET_CLIENT_ID and BNET_CLIENT_SECRET must be set, see .env.example')
  }

  const res = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status} ${await res.text()}`)
  }

  const data = (await res.json()) as { access_token: string; expires_in: number }
  token = data.access_token
  // refresh a minute early so a request never goes out with a stale token
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
  return token
}

async function apiGet<T>(path: string, namespace = NAMESPACE): Promise<T> {
  const url = `${API_HOST}${path}?namespace=${namespace}&locale=${LOCALE}`
  for (let attempt = 0; ; attempt++) {
    const accessToken = await getToken()
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    // back off when the rate limit bites instead of failing the whole run
    if (res.status === 429 && attempt < 5) {
      const wait = Number(res.headers.get('retry-after')) || 2 ** attempt
      await new Promise(r => setTimeout(r, wait * 1000))
      continue
    }
    if (res.status === 404) {
      throw new Error(`Not found: ${path} (check realm slug and character name)`)
    }
    if (!res.ok) {
      throw new Error(`API request failed: ${res.status} ${await res.text()}`)
    }
    return res.json() as Promise<T>
  }
}

function characterPath(realm: string, name: string, subresource?: string): string {
  const base = `/profile/wow/character/${realm.toLowerCase()}/${encodeURIComponent(name.toLowerCase())}`
  return subresource ? `${base}/${subresource}` : base
}

export function getCharacterProfile(realm: string, name: string): Promise<CharacterProfile>
export function getCharacterProfile(realm: string, name: string, subresource: 'achievements'): Promise<AchievementsSummary>
export function getCharacterProfile(realm: string, name: string, subresource?: string): Promise<unknown>
export function getCharacterProfile(realm: string, name: string, subresource?: string): Promise<unknown> {
  return apiGet(characterPath(realm, name, subresource))
}

export function getGuildRoster(realm: string, guildSlug: string): Promise<GuildRoster> {
  return apiGet(`/data/wow/guild/${realm.toLowerCase()}/${guildSlug.toLowerCase()}/roster`)
}

export interface RealmIndex {
  realms: { name: string; slug: string }[]
}

export function getRealmIndex(): Promise<RealmIndex> {
  return apiGet('/data/wow/realm/index', 'dynamic-eu')
}
