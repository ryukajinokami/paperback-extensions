export interface PoseidonSearchMetadata {
  page: number
}

export interface PoseidonViewMoreMetadata {
  page: number
}

export interface PoseidonSearchParameters {
  status?: string
  sortBy?: string
  minChapters?: string
  maxChapters?: string
}

export interface PoseidonSearchFilters {
  tags: string[]
  status?: string
}

export const enum PoseidonHomeSectionId {
  LatestChapters = 'latest_chapters',
  Popular = 'popular',
  NewSeries = 'new_series',
  Catalogue = 'catalogue'
}

export interface PoseidonPerson {
  name?: string
}

export interface PoseidonJsonLdIssue {
  '@type'?: string
  issueNumber?: string | number
  name?: string
  url?: string
}

export interface PoseidonJsonLd {
  '@type'?: string | string[]
  name?: string
  description?: string
  url?: string
  image?: string | { url?: string }
  author?: string | PoseidonPerson
  artist?: string | PoseidonPerson
  genre?: string | string[]
  datePublished?: string
  dateModified?: string
  numberOfEpisodes?: number
  hasPart?: PoseidonJsonLdIssue[]
}
