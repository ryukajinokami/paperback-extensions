export interface MangasOriginesSearchMetadata {
  page: number
}

export interface MangasOriginesViewMoreMetadata {
  page: number
}

export interface MangasOriginesSearchParameters {
  orderBy?: string
}

export const enum MangasOriginesHomeSectionId {
  Latest = 'latest',
  Popular = 'popular',
  Trending = 'trending',
  NewSeries = 'new_series',
  Rating = 'rating'
}

export interface MangasOriginesGenre {
  id: string
  label: string
}
