import {
  BadgeColor,
  Chapter,
  ChapterDetails,
  ChapterProviding,
  ContentRating,
  HomeSection,
  HomeSectionType,
  MangaProviding,
  PagedResults,
  Request,
  RequestManager,
  Response,
  SearchField,
  SearchRequest,
  Searchable,
  SourceInterceptor,
  SourceInfo,
  SourceIntents,
  SourceManga,
  TagSection
} from '@paperback/types'
import { OmegaHomeSectionId, OmegaListResponse, OmegaSeries, SearchMetadata, ViewMoreMetadata, OmegaChapter, OmegaSearchParameters, OmegaTag } from './models'
import { OmegaScansParser } from './OmegaScansParser'

const BASE_URL = 'https://omegascans.org'
const API_URL = 'https://api.omegascans.org'
const PAGE_SIZE = 24

export const OmegaScansInfo: SourceInfo = {
  name: 'Omega Scans',
  author: 'Paperback Community',
  description: 'Omega Scans source for Paperback v0.8. Supports search, details, chapters and reader pages.',
  contentRating: ContentRating.ADULT,
  icon: 'icon.png',
  version: '1.0.0',
  websiteBaseURL: BASE_URL,
  language: 'English',
  sourceTags: [
    { text: 'English', type: BadgeColor.BLUE },
    { text: 'Comic', type: BadgeColor.GREEN },
    { text: 'Novel', type: BadgeColor.GREY }
  ],
  intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS
}

export class OmegaScans implements Searchable, MangaProviding, ChapterProviding {
  private readonly interceptor: SourceInterceptor = {
    interceptRequest: async request => {
      request.headers = {
        ...request.headers,
        ...this.headers(request.url)
      }

      return request
    },
    interceptResponse: async response => response
  }

  readonly requestManager: RequestManager = App.createRequestManager({
    interceptor: this.interceptor,
    requestsPerSecond: 2,
    requestTimeout: 20000
  })

  private readonly parser = new OmegaScansParser(BASE_URL, API_URL)

  async getSearchResults(query: SearchRequest, metadata: unknown | undefined): Promise<PagedResults> {
    const page = (metadata as SearchMetadata | undefined)?.page ?? 1
    const params = this.searchParameters(query, page)
    const response = await this.requestJson<OmegaListResponse<OmegaSeries>>(this.parser.buildApiUrl('/query', params))

    if (query.excludedTags.length > 0) {
      response.data = await this.excludeTaggedSeries(response.data, query)
    }

    return this.parser.parsePagedSeries(response)
  }

  async getSearchTags(): Promise<TagSection[]> {
    const tags = await this.requestJson<OmegaTag[]>(this.parser.buildApiUrl('/tags', { all: true }))

    return this.parser.parseSearchTags(tags)
  }

  async getSearchFields(): Promise<SearchField[]> {
    return [
      App.createSearchField({
        id: 'series_type',
        name: 'Type',
        placeholder: 'Comic, Novel or All'
      }),
      App.createSearchField({
        id: 'status',
        name: 'Status',
        placeholder: 'All, Ongoing, Completed, Hiatus or Dropped'
      }),
      App.createSearchField({
        id: 'orderBy',
        name: 'Order by',
        placeholder: 'updated_at, created_at, total_views, title or rating'
      }),
      App.createSearchField({
        id: 'order',
        name: 'Order',
        placeholder: 'asc or desc'
      })
    ]
  }

  async supportsTagExclusion(): Promise<boolean> {
    return true
  }

  async supportsSearchOperators(): Promise<boolean> {
    return false
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const series = await this.requestJson<OmegaSeries>(this.parser.buildApiUrl(`/series/${encodeURIComponent(mangaId)}`))

    return App.createSourceManga({
      id: mangaId,
      mangaInfo: this.parser.parseMangaDetails(series)
    })
  }

  async getChapters(mangaId: string): Promise<Chapter[]> {
    const series = await this.requestJson<OmegaSeries>(this.parser.buildApiUrl(`/series/${encodeURIComponent(mangaId)}`))
    const response = await this.requestJson<OmegaListResponse<OmegaChapter>>(this.parser.buildApiUrl('/chapter/query', {
      page: 1,
      perPage: 10000,
      series_id: series.id
    }))

    return this.parser.parseChapters(response)
  }

  async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
    const html = await this.requestText(this.parser.buildChapterUrl(mangaId, chapterId))

    return this.parser.parseChapterDetails(mangaId, chapterId, html)
  }

  getMangaShareUrl(mangaId: string): string {
    return this.parser.buildSeriesUrl(mangaId)
  }

  async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
    const sections = [
      App.createHomeSection({
        id: OmegaHomeSectionId.LatestComics,
        title: 'Latest Comics',
        type: HomeSectionType.singleRowNormal,
        items: [],
        containsMoreItems: true
      }),
      App.createHomeSection({
        id: OmegaHomeSectionId.LatestNovels,
        title: 'Latest Novels',
        type: HomeSectionType.singleRowNormal,
        items: [],
        containsMoreItems: true
      }),
      App.createHomeSection({
        id: OmegaHomeSectionId.TrendingWeekly,
        title: 'Trending Weekly',
        type: HomeSectionType.singleRowNormal,
        items: [],
        containsMoreItems: false
      }),
      App.createHomeSection({
        id: OmegaHomeSectionId.TrendingDaily,
        title: 'Trending Daily',
        type: HomeSectionType.singleRowNormal,
        items: [],
        containsMoreItems: false
      }),
      App.createHomeSection({
        id: OmegaHomeSectionId.Popular,
        title: 'Most Viewed',
        type: HomeSectionType.singleRowNormal,
        items: [],
        containsMoreItems: true
      })
    ]

    for (const section of sections) {
      sectionCallback(section)
    }

    await Promise.all(sections.map(async section => {
      try {
        const results = await this.getViewMoreItems(section.id, { page: 1 })
        section.items = results.results
        section.containsMoreItems = results.metadata !== undefined
        sectionCallback(section)
      } catch (error) {
        console.log(`OmegaScans homepage section failed: ${section.id} ${String(error)}`)
      }
    }))
  }

  async getViewMoreItems(homepageSectionId: string, metadata: unknown | undefined): Promise<PagedResults> {
    const page = (metadata as ViewMoreMetadata | undefined)?.page ?? 1

    switch (homepageSectionId) {
      case OmegaHomeSectionId.LatestComics:
        return this.getLatest('Comic', page)
      case OmegaHomeSectionId.LatestNovels:
        return this.getLatest('Novel', page)
      case OmegaHomeSectionId.TrendingWeekly:
        return this.getTrending('weekly')
      case OmegaHomeSectionId.TrendingDaily:
        return this.getTrending('daily')
      case OmegaHomeSectionId.Popular:
        return this.getPopular(page)
      default:
        return App.createPagedResults({ results: [] })
    }
  }

  private async getLatest(seriesType: 'Comic' | 'Novel', page: number): Promise<PagedResults> {
    const response = await this.requestJson<OmegaListResponse<OmegaSeries>>(this.parser.buildApiUrl('/query', {
      series_type: seriesType,
      perPage: 24,
      adult: true,
      order: 'desc',
      orderBy: seriesType === 'Comic' ? 'latest' : 'updated_at',
      page
    }))

    return this.parser.parsePagedSeries(response)
  }

  private async getPopular(page: number): Promise<PagedResults> {
    const response = await this.requestJson<OmegaListResponse<OmegaSeries>>(this.parser.buildApiUrl('/query', {
      series_type: 'Comic',
      perPage: 24,
      adult: true,
      order: 'desc',
      orderBy: 'total_views',
      status: 'All',
      tags_ids: '[]',
      page
    }))

    return this.parser.parsePagedSeries(response)
  }

  private async getTrending(type: 'daily' | 'weekly'): Promise<PagedResults> {
    const series = await this.requestJson<OmegaSeries[]>(this.parser.buildApiUrl('/trending', { type }))

    return App.createPagedResults({
      results: series.map(item => this.parser.toPartialSourceManga(item))
    })
  }

  private searchParameters(query: SearchRequest, page: number): Record<string, string | number | boolean | undefined> {
    const included = this.parser.splitSearchTags(query.includedTags)
    const parameters = query.parameters as OmegaSearchParameters
    const title = query.title?.trim() ?? ''
    const orderBy = this.normalizeOrderBy(parameters.orderBy, title.length > 0 ? 'title' : 'updated_at')

    return {
      page,
      perPage: PAGE_SIZE,
      adult: true,
      query_string: title,
      series_type: this.normalizeSeriesType(parameters.series_type ?? included.type ?? 'Comic'),
      status: this.normalizeStatus(parameters.status ?? included.status ?? 'All'),
      orderBy,
      order: this.normalizeOrder(parameters.order, orderBy === 'title' ? 'asc' : 'desc'),
      tags_ids: `[${included.genreIds.join(',')}]`
    }
  }

  private async excludeTaggedSeries(series: OmegaSeries[], query: SearchRequest): Promise<OmegaSeries[]> {
    const excluded = this.parser.splitSearchTags(query.excludedTags)

    return (await Promise.all(series.map(async item => {
      if (excluded.type && item.series_type === excluded.type) {
        return undefined
      }

      if (excluded.status && item.status === excluded.status) {
        return undefined
      }

      if (excluded.genreIds.length === 0) {
        return item
      }

      const details = await this.requestJson<OmegaSeries>(this.parser.buildApiUrl(`/series/${encodeURIComponent(item.series_slug)}`))
      return this.parser.seriesHasAnyTag(details, excluded.genreIds) ? undefined : item
    }))).filter((item): item is OmegaSeries => item !== undefined)
  }

  private normalizeSeriesType(value?: string): string | undefined {
    const normalized = (value ?? 'Comic').trim().toLowerCase()

    if (normalized === 'all' || normalized === '') {
      return undefined
    }

    if (normalized === 'novel') {
      return 'Novel'
    }

    return 'Comic'
  }

  private normalizeStatus(value?: string): string {
    const normalized = (value ?? 'All').trim().toLowerCase()

    switch (normalized) {
      case 'ongoing': return 'Ongoing'
      case 'completed': return 'Completed'
      case 'hiatus': return 'Hiatus'
      case 'dropped': return 'Dropped'
      default: return 'All'
    }
  }

  private normalizeOrderBy(value: string | undefined, fallback: string): string {
    switch ((value ?? fallback).trim()) {
      case 'created_at':
      case 'updated_at':
      case 'total_views':
      case 'title':
      case 'rating':
        return (value ?? fallback).trim()
      case 'latest':
        return 'latest'
      default:
        return fallback
    }
  }

  private normalizeOrder(value: string | undefined, fallback: 'asc' | 'desc'): string {
    return (value ?? fallback).trim().toLowerCase() === 'asc' ? 'asc' : 'desc'
  }

  private async requestJson<T>(url: string): Promise<T> {
    const text = await this.requestText(url)

    try {
      return JSON.parse(text) as T
    } catch (error) {
      throw new Error(`OmegaScans returned invalid JSON for ${url}: ${String(error)}`)
    }
  }

  private async requestText(url: string): Promise<string> {
    const request = App.createRequest({
      url,
      method: 'GET',
      headers: this.headers(url)
    })

    let response: Response
    try {
      response = await this.requestManager.schedule(request, 2)
    } catch (error) {
      throw new Error(`OmegaScans network request failed for ${url}: ${String(error)}`)
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`OmegaScans request failed for ${url}: HTTP ${response.status}`)
    }

    if (typeof response.data !== 'string') {
      throw new Error(`OmegaScans returned an empty response for ${url}`)
    }

    return response.data
  }

  private headers(url: string): Request['headers'] {
    const imageRequest = /\.(?:jpg|jpeg|png|webp|gif)(?:[?#].*)?$/i.test(url)

    return {
      referer: `${BASE_URL}/`,
      origin: BASE_URL,
      accept: imageRequest ? 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' : url.startsWith(API_URL) ? 'application/json, text/plain, */*' : 'text/html,application/xhtml+xml',
      'user-agent': 'Paperback/0.8'
    }
  }
}
