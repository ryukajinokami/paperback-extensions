export interface HentaiScantradSearchMetadata {
  page: number
}

export interface HentaiScantradViewMoreMetadata {
  page: number
}

export interface HentaiScantradSearchParameters {
  orderBy?: string
}

export const enum HentaiScantradHomeSectionId {
  Latest = 'latest',
  Popular = 'popular',
  Trending = 'trending',
  NewSeries = 'new_series',
  Rating = 'rating'
}

export interface HentaiScantradGenre {
  id: string
  label: string
}
