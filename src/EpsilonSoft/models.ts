export interface EpsilonSearchMetadata {
  page: number
}

export interface EpsilonViewMoreMetadata {
  page: number
}

export interface EpsilonSearchParameters {
  status?: string
  sortBy?: string
  minChapters?: string
  maxChapters?: string
}

export interface EpsilonSearchFilters {
  tags: string[]
  status?: string
}

export const enum EpsilonHomeSectionId {
  LatestChapters = 'latest_chapters',
  Popular = 'popular',
  NewSeries = 'new_series',
  Catalogue = 'catalogue'
}

export interface EpsilonPerson {
  name?: string
}

export interface EpsilonJsonLdIssue {
  '@type'?: string
  issueNumber?: string | number
  name?: string
  url?: string
}

export interface EpsilonJsonLd {
  '@type'?: string | string[]
  name?: string
  description?: string
  url?: string
  image?: string | { url?: string }
  author?: string | EpsilonPerson
  artist?: string | EpsilonPerson
  genre?: string | string[]
  datePublished?: string
  dateModified?: string
  numberOfEpisodes?: number
  hasPart?: EpsilonJsonLdIssue[]
}
