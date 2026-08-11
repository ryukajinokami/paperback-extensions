export interface MangasOrigines2026SearchMetadata {
  page: number
}

export interface MangasOrigines2026ViewMoreMetadata {
  page: number
}

export interface MangasOrigines2026SearchParameters {
  orderBy?: string
}

export const enum MangasOrigines2026HomeSectionId {
  Latest = 'latest',
  Popular = 'popular',
  Trending = 'trending',
  NewSeries = 'new_series',
  Rating = 'rating',
  Alphabet = 'alphabet'
}

export interface MangasOrigines2026Genre {
  id: string
  label: string
}
