import { getCharacterProfile } from './blizzard'

// Omnium Folio Studies tracks the five weekly unlocks in its criteria amount
export const FOLIO_STUDIES = 63325
// The Sunstrider Omnium is the intro questline that unlocks the folio
export const SUNSTRIDER_OMNIUM = 62606
// Mythic kill achievements for The Venomous Abyss bosses. Kith'ix has none.
export const MYTHIC_BOSSES = [63523, 63524, 63525, 63526, 63527, 63528, 63529, 63476, 63682]
// Mythic: Ula'tek, the end boss
export const MYTHIC_ULATEK = 63476

export interface CharCheck {
  weeks: number
  unlocked: boolean
  // how many Venomous Abyss bosses the character has killed on mythic
  bossKills: number
  ulatekKill: boolean
  // when the character earned the mythic Ula'tek achievement
  ulatekWhen?: number
  error?: boolean
}

async function checkOne(realm: string, name: string): Promise<CharCheck> {
  try {
    const data = await getCharacterProfile(realm, name, 'achievements')
    const done = new Map(
      data.achievements.filter(a => a.criteria?.is_completed).map(a => [a.id, a]),
    )
    return {
      weeks: data.achievements.find(a => a.id === FOLIO_STUDIES)?.criteria?.amount ?? 0,
      unlocked: done.has(SUNSTRIDER_OMNIUM),
      bossKills: MYTHIC_BOSSES.filter(id => done.has(id)).length,
      ulatekKill: done.has(MYTHIC_ULATEK),
      ulatekWhen: done.get(MYTHIC_ULATEK)?.completed_timestamp,
    }
  } catch {
    return { weeks: 0, unlocked: false, bossKills: 0, ulatekKill: false, error: true }
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
