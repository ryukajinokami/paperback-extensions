export interface AstralMetadata { page: number }
export interface AstralSearchParameters { sort?: string, status?: string, type?: string }
export const enum AstralHomeSectionId {
  Latest = 'latest',
  Popular = 'popular',
  Alphabetical = 'alphabetical'
}
