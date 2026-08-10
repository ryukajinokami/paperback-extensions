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
  PartialSourceManga,
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
  Tag,
  TagSection
} from '@paperback/types'
import { MangasOriginesHomeSectionId, MangasOriginesSearchMetadata, MangasOriginesSearchParameters, MangasOriginesViewMoreMetadata } from './models'
import { MangasOriginesParser } from './MangasOriginesParser'
import { BUILD_VERSION } from './version'
import { isCloudflareChallenge } from '../utils/cloudflare'

const BASE_URL = 'https://mangas-origines.fr'
const AJAX_URL = `${BASE_URL}/wp-admin/admin-ajax.php?paperback=1`

interface CatalogueResponse {
  success?: boolean
  data?: {
    html?: string
    more?: boolean
  }
}

export const MangasOriginesInfo: SourceInfo = {
  name: 'Mangas Origines',
  author: 'Paperback Community',
  description: 'French Mangas Origines source with Madara catalogue filters, details and public reader pages.',
  contentRating: ContentRating.ADULT,
  icon: 'icon.png',
  version: BUILD_VERSION,
  websiteBaseURL: BASE_URL,
  language: 'French',
  sourceTags: [
    { text: 'French', type: BadgeColor.BLUE },
    { text: 'Madara', type: BadgeColor.GREEN }
  ],
  intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS | SourceIntents.CLOUDFLARE_BYPASS_REQUIRED
}

export class MangasOrigines implements Searchable, MangaProviding, ChapterProviding {
  private readonly interceptor: SourceInterceptor = {
    interceptRequest: async request => {
      request.headers = {
        ...await this.headers(request.url),
        ...request.headers
      }

      return request
    },
    interceptResponse: async response => response
  }

  readonly requestManager: RequestManager = App.createRequestManager({
    interceptor: this.interceptor,
    requestsPerSecond: 1,
    requestTimeout: 20000
  })

  private readonly parser = new MangasOriginesParser(BASE_URL)

  async getSearchResults(query: SearchRequest, metadata: unknown | undefined): Promise<PagedResults> {
    const page = (metadata as MangasOriginesSearchMetadata | undefined)?.page ?? 1
    const orderBy = this.normalizeOrderBy((query.parameters as MangasOriginesSearchParameters | undefined)?.orderBy, query.title?.trim().length ? 'relevance' : 'modified')
    const includedTagIds = query.includedTags.map(tag => tag.id)
    const results = await this.getCataloguePage(orderBy, page, query.title?.trim() ?? '', includedTagIds)

    if (query.excludedTags.length === 0) {
      return results
    }

    return App.createPagedResults({
      results: await this.excludeTaggedResults(results.results, query.excludedTags),
      metadata: results.metadata
    })
  }

  async getSearchTags(): Promise<TagSection[]> {
    const html = await this.requestText(this.parser.buildArchiveUrl('modified', 1))

    return this.parser.parseSearchTags(html)
  }

  async getSearchFields(): Promise<SearchField[]> {
    return [
      App.createSearchField({
        id: 'orderBy',
        name: 'Order by',
        placeholder: 'modified, views, trending, rating, new-manga, alphabet or relevance'
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
    const html = await this.requestText(this.parser.buildSeriesUrl(mangaId))

    return App.createSourceManga({
      id: mangaId,
      mangaInfo: this.parser.parseMangaDetails(mangaId, html)
    })
  }

  async getChapters(mangaId: string): Promise<Chapter[]> {
    try {
      const html = await this.requestText(this.parser.buildChaptersUrl(mangaId), 'POST', {
        'x-requested-with': 'XMLHttpRequest',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        referer: this.parser.buildSeriesUrl(mangaId)
      }, { paperback: 1 })

      const chapters = this.parser.parseChapters(mangaId, html)
      if (chapters.length > 0) {
        return chapters
      }
    } catch (error) {
      console.log(`MangasOrigines chapter AJAX failed for ${mangaId}, using series fallback: ${String(error)}`)
    }

    const seriesHtml = await this.requestText(this.parser.buildSeriesUrl(mangaId))

    return this.parser.parseChapterRange(mangaId, seriesHtml)
  }

  async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
    const html = await this.requestText(this.parser.buildChapterUrl(mangaId, chapterId))

    return this.parser.parseChapterDetails(mangaId, chapterId, html)
  }

  getMangaShareUrl(mangaId: string): string {
    return this.parser.buildSeriesUrl(mangaId)
  }

  async getCloudflareBypassRequestAsync(): Promise<Request> {
    const url = this.parser.buildArchiveUrl('modified', 1)

    return App.createRequest({ url, method: 'GET', headers: await this.headers(url) })
  }

  async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
    const sections = [
      App.createHomeSection({
        id: MangasOriginesHomeSectionId.Latest,
        title: 'Latest Updates',
        type: HomeSectionType.singleRowNormal,
        items: [],
        containsMoreItems: true
      }),
      App.createHomeSection({
        id: MangasOriginesHomeSectionId.Popular,
        title: 'Most Viewed',
        type: HomeSectionType.singleRowNormal,
        items: [],
        containsMoreItems: true
      }),
      App.createHomeSection({
        id: MangasOriginesHomeSectionId.Rating,
        title: 'Highest Rated',
        type: HomeSectionType.singleRowNormal,
        items: [],
        containsMoreItems: true
      }),
      App.createHomeSection({
        id: MangasOriginesHomeSectionId.Alphabet,
        title: 'A-Z',
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
        console.log(`MangasOrigines homepage section failed: ${section.id} ${String(error)}`)
      }
    }))
  }

  async getViewMoreItems(homepageSectionId: string, metadata: unknown | undefined): Promise<PagedResults> {
    const page = (metadata as MangasOriginesViewMoreMetadata | undefined)?.page ?? 1

    switch (homepageSectionId) {
      case MangasOriginesHomeSectionId.Latest:
        return this.getArchivePage('modified', page)
      case MangasOriginesHomeSectionId.Popular:
        return this.getArchivePage('views', page)
      case MangasOriginesHomeSectionId.Trending:
        return this.getArchivePage('trending', page)
      case MangasOriginesHomeSectionId.NewSeries:
        return this.getArchivePage('new-manga', page)
      case MangasOriginesHomeSectionId.Rating:
        return this.getArchivePage('rating', page)
      case MangasOriginesHomeSectionId.Alphabet:
        return this.getArchivePage('alphabet', page)
      default:
        return App.createPagedResults({ results: [] })
    }
  }

  private async getArchivePage(orderBy: string, page: number): Promise<PagedResults> {
    return this.getCataloguePage(orderBy, page)
  }

  private async getCataloguePage(orderBy: string, page: number, title = '', includedTagIds: string[] = []): Promise<PagedResults> {
    const response = await this.requestText(AJAX_URL, 'POST', {
      accept: 'application/json, text/javascript, */*; q=0.01',
      'x-requested-with': 'XMLHttpRequest',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      referer: `${BASE_URL}/catalogues/`
    }, {
      action: 'madara_child_catalogue',
      s: title,
      genres: includedTagIds.join(','),
      statut: 'tous',
      note: 0,
      origine: '',
      tri: this.catalogueSort(orderBy),
      chmin: 0,
      chmax: 0,
      page,
      auteur: '',
      artiste: '',
      annee: ''
    })

    let payload: CatalogueResponse
    try {
      payload = JSON.parse(response) as CatalogueResponse
    } catch (error) {
      throw new Error(`Mangas Origines returned invalid catalogue JSON: ${String(error)}`)
    }

    if (!payload.success || typeof payload.data?.html !== 'string') {
      throw new Error('Mangas Origines catalogue request was rejected')
    }

    const parsed = this.parser.parseMangaList(payload.data.html, page)

    return App.createPagedResults({
      results: parsed.results,
      metadata: payload.data.more ? { page: page + 1 } : undefined
    })
  }

  private catalogueSort(orderBy: string): string {
    switch (orderBy) {
      case 'views':
      case 'trending':
        return 'populaire'
      case 'rating':
        return 'notes'
      case 'alphabet':
        return 'az'
      default:
        return 'recents'
    }
  }

  private async excludeTaggedResults(results: PartialSourceManga[], excludedTags: Tag[]): Promise<PartialSourceManga[]> {
    const excludedIds = excludedTags.map(tag => tag.id)

    return (await Promise.all(results.map(async result => {
      try {
        const html = await this.requestText(this.parser.buildSeriesUrl(result.mangaId))
        const seriesTagIds = this.parser.parseGenreIdsFromDetails(html)

        return excludedIds.some(tagId => seriesTagIds.includes(tagId)) ? undefined : result
      } catch (error) {
        console.log(`MangasOrigines tag exclusion skipped for ${result.mangaId}: ${String(error)}`)
        return result
      }
    }))).filter((result): result is PartialSourceManga => result !== undefined)
  }

  private normalizeOrderBy(value: string | undefined, fallback: string): string {
    const normalized = (value ?? fallback).trim()

    switch (normalized) {
      case 'modified':
      case 'views':
      case 'trending':
      case 'rating':
      case 'new-manga':
      case 'alphabet':
      case 'relevance':
        return normalized
      default:
        return fallback
    }
  }

  private async requestText(url: string, method = 'GET', headers: Request['headers'] = {}, data?: unknown): Promise<string> {
    const request = App.createRequest({
      url,
      method,
      headers: {
        ...await this.headers(url),
        ...headers
      },
      data: method === 'POST' ? data ?? {} : undefined
    })

    let response: Response
    try {
      response = await this.requestManager.schedule(request, 2)
    } catch (error) {
      throw new Error(`MangasOrigines network request failed for ${url}: ${String(error)}`)
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Mangas Origines request failed for ${url}: HTTP ${response.status}${response.status === 403 ? ' (Cloudflare challenge)' : ''}`)
    }

    if (typeof response.data !== 'string') {
      throw new Error(`MangasOrigines returned an empty response for ${url}`)
    }

    if (isCloudflareChallenge(response.data)) {
      throw new Error(`Mangas Origines Cloudflare challenge was returned for ${url}`)
    }

    return response.data
  }

  private async headers(url: string): Promise<Request['headers']> {
    const imageRequest = /\.(?:jpg|jpeg|png|webp|gif)(?:[?#].*)?$/i.test(url)

    return {
      referer: `${BASE_URL}/`,
      origin: BASE_URL,
      accept: imageRequest ? 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'user-agent': await this.requestManager.getDefaultUserAgent()
    }
  }
}
