import { getCharacterProfile } from './blizzard'

// Omnium Folio Studies tracks the five weekly unlocks in its criteria amount
export const FOLIO_STUDIES = 63325
// The Sunstrider Omnium is the intro questline that unlocks the folio
export const SUNSTRIDER_OMNIUM = 62606
// Mythic: Midnight Falls, awarded for killing L'ura on mythic
export const MYTHIC_LURA = 61379

export interface CharCheck {
  weeks: number
  unlocked: boolean
  luraKill: boolean
  error?: boolean
}

async function checkOne(realm: string, name: string): Promise<CharCheck> {
  try {
    const data = await getCharacterProfile(realm, name, 'achievements')
    const folio = data.achievements.find(a => a.id === FOLIO_STUDIES)
    const unlock = data.achievements.find(a => a.id === SUNSTRIDER_OMNIUM)
    const lura = data.achievements.find(a => a.id === MYTHIC_LURA)
    return {
      weeks: folio?.criteria?.amount ?? 0,
      unlocked: unlock?.criteria?.is_completed === true,
      luraKill: lura?.criteria?.is_completed === true,
    }
  } catch {
    return { weeks: 0, unlocked: false, luraKill: false, error: true }
  }
}

export async function checkCharacters<T extends { name: string; realm: string }>(
  chars: T[],
): Promise<(T & CharCheck)[]> {
  const results: (T & CharCheck)[] = []
  // small batches so we do not hammer the API
  for (let i = 0; i < chars.length; i += 5) {
    results.push(...await Promise.all(
      chars.slice(i, i + 5).map(async c => ({ ...c, ...await checkOne(c.realm, c.name) })),
    ))
  }
  return results
}

export function isDone(r: CharCheck): boolean {
  return !r.error && r.weeks >= 5
}

export function progressOf(r: CharCheck): { cls: string; progress: string } {
  if (r.error) return { cls: 'nodata', progress: 'no profile data' }
  if (r.unlocked) return { cls: 'partial', progress: `${r.weeks}/5 weeks` }
  return { cls: 'locked', progress: `not unlocked (${r.weeks}/5)` }
}
