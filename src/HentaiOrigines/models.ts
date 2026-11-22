export interface HentaiOriginesSearchMetadata {
  page: number
}

export interface HentaiOriginesViewMoreMetadata {
  page: number
}

export interface HentaiOriginesSearchParameters {
  orderBy?: string
}

export const enum HentaiOriginesHomeSectionId {
  Latest = 'latest',
  Popular = 'popular',
  Trending = 'trending',
  NewSeries = 'new_series',
  Rating = 'rating',
  Alphabet = 'alphabet'
}

export interface HentaiOriginesGenre {
  id: string
  label: string
}
