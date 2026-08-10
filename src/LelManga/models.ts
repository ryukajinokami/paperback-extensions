export interface LelMangaMetadata {
  page: number
}

export interface LelMangaSearchParameters {
  status?: string
  type?: string
  order?: string
}

export const enum LelMangaHomeSectionId {
  LatestUpdates = 'latest_updates',
  Popular = 'popular',
  NewSeries = 'new_series'
}
