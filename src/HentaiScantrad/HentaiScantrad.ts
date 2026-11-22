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
import { HentaiScantradHomeSectionId, HentaiScantradSearchMetadata, HentaiScantradSearchParameters, HentaiScantradViewMoreMetadata } from './models'
import { MangaDistrictParser } from '../MangaDistrict/MangaDistrictParser'
import { BUILD_VERSION } from './version'

const BASE_URL = 'https://hentai-scantrad.org'

export const HentaiScantradInfo: SourceInfo = {
  name: 'Hentai-Scantrad',
  author: 'Paperback Community',
  description: 'Source française Hentai-Scantrad pour Paperback v0.8 : catalogue, fiches et chapitres publics.',
  contentRating: ContentRating.ADULT,
  icon: 'icon.png',
  version: BUILD_VERSION,
  websiteBaseURL: BASE_URL,
  language: 'French',
  sourceTags: [
    { text: 'French', type: BadgeColor.BLUE },
    { text: 'Adult', type: BadgeColor.GREY },
    { text: 'Madara', type: BadgeColor.GREEN }
  ],
  intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS
}

export class HentaiScantrad implements Searchable, MangaProviding, ChapterProviding {
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
    requestsPerSecond: 1,
    requestTimeout: 20000
  })

  private readonly parser = new MangaDistrictParser(BASE_URL, { archivePath: 'manga', seriesPath: 'manga', genrePath: 'manga-genre', sourceName: 'Hentai-Scantrad', langCode: 'fr', hentai: true, readerImageOrigins: ['https://stockage.hentai-scantrad.org'] })

  async getSearchResults(query: SearchRequest, metadata: unknown | undefined): Promise<PagedResults> {
    const page = (metadata as HentaiScantradSearchMetadata | undefined)?.page ?? 1
    const orderBy = this.normalizeOrderBy((query.parameters as HentaiScantradSearchParameters | undefined)?.orderBy, query.title?.trim().length ? 'relevance' : 'modified')
    const includedTagIds = query.includedTags.map(tag => tag.id)
    const url = query.title?.trim()
      ? this.parser.buildSearchUrl(query.title.trim(), page, orderBy, includedTagIds)
      : this.parser.buildArchiveUrl(orderBy, page, includedTagIds)
    const html = await this.requestText(url)
    const results = this.parser.parseMangaList(html, page)

    if (query.excludedTags.length === 0) {
      return results
    }

    return App.createPagedResults({
      results: await this.excludeTaggedResults(results.results, query.excludedTags),
      metadata: results.metadata
    })
  }

  async getSearchTags(): Promise<TagSection[]> {
    const html = await this.requestText(`${BASE_URL}/?s=&post_type=wp-manga`)

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
    const html = await this.requestText(`${this.parser.buildSeriesUrl(mangaId)}ajax/chapters/`, 'POST')
    const chapters = this.parser.parseChapters(mangaId, html)
    if (chapters.length === 0) throw new Error('Hentai-Scantrad: no public chapters found')
    return chapters
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
        id: HentaiScantradHomeSectionId.Latest,
        title: 'Latest Updates',
        type: HomeSectionType.singleRowNormal,
        items: [],
        containsMoreItems: true
      }),
      App.createHomeSection({
        id: HentaiScantradHomeSectionId.Popular,
        title: 'Most Viewed',
        type: HomeSectionType.singleRowNormal,
        items: [],
        containsMoreItems: true
      }),
      App.createHomeSection({
        id: HentaiScantradHomeSectionId.Trending,
        title: 'Trending',
        type: HomeSectionType.singleRowNormal,
        items: [],
        containsMoreItems: true
      }),
      App.createHomeSection({
        id: HentaiScantradHomeSectionId.NewSeries,
        title: 'New Series',
        type: HomeSectionType.singleRowNormal,
        items: [],
        containsMoreItems: true
      }),
      App.createHomeSection({
        id: HentaiScantradHomeSectionId.Rating,
        title: 'Highest Rated',
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
        console.log(`HentaiScantrad homepage section failed: ${section.id} ${String(error)}`)
      }
    }))
  }

  async getViewMoreItems(homepageSectionId: string, metadata: unknown | undefined): Promise<PagedResults> {
    const page = (metadata as HentaiScantradViewMoreMetadata | undefined)?.page ?? 1

    switch (homepageSectionId) {
      case HentaiScantradHomeSectionId.Latest:
        return this.getArchivePage('modified', page)
      case HentaiScantradHomeSectionId.Popular:
        return this.getArchivePage('views', page)
      case HentaiScantradHomeSectionId.Trending:
        return this.getArchivePage('trending', page)
      case HentaiScantradHomeSectionId.NewSeries:
        return this.getArchivePage('new-manga', page)
      case HentaiScantradHomeSectionId.Rating:
        return this.getArchivePage('rating', page)
      default:
        return App.createPagedResults({ results: [] })
    }
  }

  private async getArchivePage(orderBy: string, page: number): Promise<PagedResults> {
    const html = await this.requestText(this.parser.buildArchiveUrl(orderBy, page))

    return this.parser.parseMangaList(html, page)
  }

  private async excludeTaggedResults(results: PartialSourceManga[], excludedTags: Tag[]): Promise<PartialSourceManga[]> {
    const excludedIds = excludedTags.map(tag => tag.id)

    return (await Promise.all(results.map(async result => {
      try {
        const html = await this.requestText(this.parser.buildSeriesUrl(result.mangaId))
        const seriesTagIds = this.parser.parseGenreIdsFromDetails(html)

        return excludedIds.some(tagId => seriesTagIds.includes(tagId)) ? undefined : result
      } catch (error) {
        console.log(`HentaiScantrad tag exclusion skipped for ${result.mangaId}: ${String(error)}`)
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

  private async requestText(url: string, method = 'GET'): Promise<string> {
    const request = App.createRequest({
      url,
      method,
      headers: this.headers(url)
    })

    let response: Response
    try {
      response = await this.requestManager.schedule(request, 2)
    } catch (error) {
      throw new Error(`HentaiScantrad network request failed for ${url}: ${String(error)}`)
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HentaiScantrad request failed for ${url}: HTTP ${response.status}`)
    }

    if (typeof response.data !== 'string') {
      throw new Error(`HentaiScantrad returned an empty response for ${url}`)
    }

    return response.data
  }

  private headers(url: string): Request['headers'] {
    const imageRequest = /\.(?:jpg|jpeg|png|webp|gif|avif)(?:[?#].*)?$/i.test(url)

    return {
      referer: `${BASE_URL}/`,
      origin: BASE_URL,
      accept: imageRequest ? 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'user-agent': 'Paperback/0.8 HentaiScantrad'
    }
  }
}
