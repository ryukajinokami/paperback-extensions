import {
  BadgeColor, Chapter, ChapterDetails, ChapterProviding, ContentRating, HomeSection, HomeSectionType,
  MangaProviding, PagedResults, Request, RequestManager, Response, SearchField, SearchRequest,
  Searchable, SourceInterceptor, SourceInfo, SourceIntents, SourceManga, TagSection
} from '@paperback/types'
import { LelMangaParser } from './LelMangaParser'
import { LelMangaHomeSectionId, LelMangaMetadata, LelMangaSearchParameters } from './models'
import { BUILD_VERSION } from './version'

const BASE_URL = 'https://www.lelmanga.com'

export const LelMangaInfo: SourceInfo = {
  name: 'LelManga',
  author: 'Paperback Community',
  description: 'French LelManga source with catalogue filters, metadata and public reader pages.',
  contentRating: ContentRating.MATURE,
  icon: 'icon.png',
  version: BUILD_VERSION,
  websiteBaseURL: BASE_URL,
  language: 'French',
  sourceTags: [
    { text: 'French', type: BadgeColor.BLUE },
    { text: 'Manga', type: BadgeColor.GREEN },
    { text: 'Manhwa', type: BadgeColor.GREY },
    { text: 'Manhua', type: BadgeColor.YELLOW }
  ],
  intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS
}

export class LelManga implements Searchable, MangaProviding, ChapterProviding {
  private readonly parser = new LelMangaParser(BASE_URL)
  private readonly interceptor: SourceInterceptor = {
    interceptRequest: async request => {
      request.headers = { ...request.headers, ...this.headers(request.url) }
      return request
    },
    interceptResponse: async response => response
  }

  readonly requestManager: RequestManager = App.createRequestManager({
    interceptor: this.interceptor,
    requestsPerSecond: 1,
    requestTimeout: 20000
  })

  async getSearchResults(query: SearchRequest, metadata: unknown | undefined): Promise<PagedResults> {
    const page = (metadata as LelMangaMetadata | undefined)?.page ?? 1
    const parameters = this.normalizeParameters(query.parameters as LelMangaSearchParameters)
    const html = await this.requestText(this.parser.buildCatalogueUrl(page, query.includedTags, parameters, query.title ?? ''))
    return this.parser.parseMangaList(html, page)
  }

  async getSearchTags(): Promise<TagSection[]> {
    return this.parser.parseSearchTags(await this.requestText(this.parser.buildCatalogueUrl(1)))
  }

  async getSearchFields(): Promise<SearchField[]> {
    return [
      App.createSearchField({ id: 'status', name: 'Statut', placeholder: 'ongoing, completed ou hiatus' }),
      App.createSearchField({ id: 'type', name: 'Type', placeholder: 'manga, manhwa, manhua ou comic' }),
      App.createSearchField({ id: 'order', name: 'Trier par', placeholder: 'update, latest, popular, title ou titlereverse' })
    ]
  }

  async supportsTagExclusion(): Promise<boolean> { return false }
  async supportsSearchOperators(): Promise<boolean> { return false }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const info = this.parser.parseMangaDetails(mangaId, await this.requestText(this.parser.buildSeriesUrl(mangaId)))
    return App.createSourceManga({ id: mangaId, mangaInfo: info })
  }

  async getChapters(mangaId: string): Promise<Chapter[]> {
    return this.parser.parseChapters(mangaId, await this.requestText(this.parser.buildSeriesUrl(mangaId)))
  }

  async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
    return this.parser.parseChapterDetails(mangaId, chapterId, await this.requestText(this.parser.buildChapterUrl(chapterId)))
  }

  getMangaShareUrl(mangaId: string): string { return this.parser.buildSeriesUrl(mangaId) }

  async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
    const sections = [
      this.section(LelMangaHomeSectionId.LatestUpdates, 'Dernieres mises a jour'),
      this.section(LelMangaHomeSectionId.Popular, 'Populaires'),
      this.section(LelMangaHomeSectionId.NewSeries, 'Nouvelles series')
    ]
    for (const section of sections) sectionCallback(section)
    await Promise.all(sections.map(async section => {
      try {
        const results = await this.getViewMoreItems(section.id, { page: 1 })
        section.items = results.results
        section.containsMoreItems = results.metadata !== undefined
        sectionCallback(section)
      } catch (error) {
        console.log(`LelManga homepage section failed: ${section.id} ${String(error)}`)
      }
    }))
  }

  async getViewMoreItems(id: string, metadata: unknown | undefined): Promise<PagedResults> {
    const page = (metadata as LelMangaMetadata | undefined)?.page ?? 1
    const order = id === LelMangaHomeSectionId.Popular ? 'popular'
      : id === LelMangaHomeSectionId.NewSeries ? 'latest' : 'update'
    const html = await this.requestText(this.parser.buildCatalogueUrl(page, [], { order }))
    return this.parser.parseMangaList(html, page)
  }

  private section(id: LelMangaHomeSectionId, title: string): HomeSection {
    return App.createHomeSection({ id, title, type: HomeSectionType.singleRowNormal, items: [], containsMoreItems: true })
  }

  private normalizeParameters(parameters: LelMangaSearchParameters): LelMangaSearchParameters {
    const status = (parameters.status ?? '').trim().toLowerCase()
    const type = (parameters.type ?? '').trim().toLowerCase()
    const order = (parameters.order ?? '').trim().toLowerCase()
    return {
      status: ['ongoing', 'completed', 'hiatus'].includes(status) ? status : undefined,
      type: ['manga', 'manhwa', 'manhua', 'comic'].includes(type) ? type : undefined,
      order: ['update', 'latest', 'popular', 'title', 'titlereverse'].includes(order) ? order : undefined
    }
  }

  private async requestText(url: string): Promise<string> {
    let response: Response
    try {
      response = await this.requestManager.schedule(App.createRequest({ url, method: 'GET', headers: this.headers(url) }), 2)
    } catch (error) {
      throw new Error(`LelManga network request failed for ${url}: ${String(error)}`)
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`LelManga request failed for ${url}: HTTP ${response.status}`)
    if (typeof response.data !== 'string') throw new Error(`LelManga returned an empty response for ${url}`)
    return response.data
  }

  private headers(url: string): Request['headers'] {
    return {
      referer: `${BASE_URL}/`,
      accept: /\.(?:jpg|jpeg|png|webp|gif)(?:[?#].*)?$/i.test(url) ? 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
    }
  }
}
