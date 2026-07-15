export interface MangaDistrictSearchMetadata {
  page: number
}

export interface MangaDistrictViewMoreMetadata {
  page: number
}

export interface MangaDistrictSearchParameters {
  orderBy?: string
}

export const enum MangaDistrictHomeSectionId {
  Latest = 'latest',
  Popular = 'popular',
  Trending = 'trending',
  NewSeries = 'new_series',
  Rating = 'rating'
}

export interface MangaDistrictGenre {
  id: string
  label: string
}
