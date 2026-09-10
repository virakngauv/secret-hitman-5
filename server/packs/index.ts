import { createHash } from 'node:crypto'
import { SECRET_HITMAN_WORDS } from '../../lib/words'

export type Pack = Readonly<{
  sourceIds?: readonly string[]
  id: string
  name: string
  description: string
  version: string
  enabled: boolean
  feature: string | null
  words: readonly string[]
}>

export function validateWords(words: readonly string[]): readonly string[] {
  const normalized = words.map((word) => word.normalize('NFKC').trim())
  if (
    normalized.length < 12 ||
    new Set(normalized.map((word) => word.toLocaleLowerCase('en-US'))).size !==
      normalized.length ||
    normalized.some(
      (word) => !word || word.length > 32 || /[\p{Cc}\p{Cf}]/u.test(word),
    ) ||
    Buffer.byteLength(JSON.stringify(normalized)) > 128 * 1024
  )
    throw new Error('Invalid deployed word pack.')
  return Object.freeze(normalized)
}

function pack(
  id: string,
  name: string,
  description: string,
  feature: string | null,
  source: readonly string[],
): Pack {
  const words = validateWords(source)
  return Object.freeze({
    id,
    name,
    description,
    feature,
    words,
    version: createHash('sha256').update(JSON.stringify(words)).digest('hex'),
    enabled: feature === null || process.env.ENABLE_WORD_PACKS === 'true',
  })
}

// Original public development samples; these are not an approved paid catalog.
export const PACKS: readonly Pack[] = Object.freeze([
  pack(
    'base',
    'Base',
    'The original free word game.',
    null,
    SECRET_HITMAN_WORDS,
  ),
  pack(
    'movies-v1',
    'Movies',
    'A development sample inspired by making movies.',
    'pack_movies_v1',
    [
      'Camera',
      'Director',
      'Screenplay',
      'Spotlight',
      'Premiere',
      'Popcorn',
      'Stunt double',
      'Red carpet',
      'Soundtrack',
      'Animation',
      'Costume',
      'Film reel',
      'Clapperboard',
      'Projector',
      'Studio',
      'Subtitle',
      'Sequel',
      'Audition',
      'Close-up',
      'Storyboard',
      'Trailer',
      'Cast',
      'Props',
      'Credits',
    ],
  ),
  pack(
    'travel-v1',
    'Travel',
    'A development sample about journeys and destinations.',
    'pack_travel_v1',
    [
      'Passport',
      'Suitcase',
      'Compass',
      'Boarding pass',
      'Platform',
      'Harbor',
      'Lighthouse',
      'Backpack',
      'Postcard',
      'Map',
      'Cable car',
      'Souvenir',
      'Campsite',
      'Ferry',
      'Mountain pass',
      'Train station',
      'Island',
      'Desert',
      'Waterfall',
      'Ticket',
      'Itinerary',
      'Telescope',
      'Tent',
      'Road trip',
    ],
  ),
])
export const BASE_PACK = PACKS[0]!
export function publicCatalog(packs: readonly Pack[] = PACKS) {
  return packs
    .filter((pack) => pack.enabled)
    .map(({ id, name, description, version, feature, words }) => ({
      id,
      name,
      description,
      version,
      premium: feature !== null,
      wordCount: words.length,
    }))
}

// Round pools remain server-owned and fixed for the lifetime of the round.
export function combinePacks(packs: readonly Pack[]): Pack {
  if (packs.length === 1) return packs[0]!
  const unique = new Map<string, string>()
  for (const pack of packs)
    for (const word of pack.words)
      unique.set(word.normalize('NFKC').toLocaleLowerCase('en-US'), word)
  const words = Object.freeze([...unique.values()])
  return Object.freeze({
    id: packs.map((pack) => pack.id).join('+'),
    sourceIds: Object.freeze(packs.map((pack) => pack.id)),
    name: packs.map((pack) => pack.name).join(' + '),
    description: 'Combined word packs.',
    version: createHash('sha256').update(JSON.stringify(words)).digest('hex'),
    enabled: packs.every((pack) => pack.enabled),
    feature: packs.find((pack) => pack.feature)?.feature ?? null,
    words,
  })
}
