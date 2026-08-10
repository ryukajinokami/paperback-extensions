export interface PoseidonSearchMetadata {
  page: number
}

export interface PoseidonViewMoreMetadata {
  page: number
}

export const enum PoseidonHomeSectionId {
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
