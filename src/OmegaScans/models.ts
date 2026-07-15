export interface OmegaApiMeta {
  total?: number
  per_page?: number
  current_page?: number
  last_page?: number
  next_page_url?: string | null
}

export interface OmegaTag {
  id: number
  name: string
}

export interface OmegaChapter {
  id: number
  chapter_name: string
  chapter_title?: string | null
  chapter_slug: string
  chapter_thumbnail?: string | null
  created_at?: string
  index?: string
  price?: number
  series_id?: number
}

export interface OmegaSeries {
  id: number
  title: string
  description?: string | null
  alternative_names?: string | null
  series_type?: string
  series_slug: string
  thumbnail?: string | null
  status?: string | null
  author?: string | null
  studio?: string | null
  adult?: boolean
  rating?: number | null
  total_views?: number
  tags?: OmegaTag[]
  free_chapters?: OmegaChapter[]
  paid_chapters?: OmegaChapter[]
  meta?: {
    chapters_count?: string
    who_bookmarked_count?: string
  }
}

export interface OmegaListResponse<T> {
  meta?: OmegaApiMeta
  data: T[]
}

export interface SearchMetadata {
  page: number
}

export interface ViewMoreMetadata {
  page: number
}

export interface OmegaSearchParameters {
  series_type?: string
  status?: string
  orderBy?: string
  order?: string
}

export const enum OmegaHomeSectionId {
  LatestComics = 'latest_comics',
  LatestNovels = 'latest_novels',
  TrendingWeekly = 'trending_weekly',
  TrendingDaily = 'trending_daily',
  Popular = 'popular'
}
