import {
  BadgeColor, Chapter, ChapterDetails, ChapterProviding, ContentRating, HomeSection, HomeSectionType,
  MangaProviding, PagedResults, Request, RequestManager, Response, SearchField, SearchRequest,
  Searchable, SourceInterceptor, SourceInfo, SourceIntents, SourceManga, TagSection
} from '@paperback/types'
import { AstralMangaParser } from './AstralMangaParser'
import { AstralHomeSectionId, AstralMetadata, AstralSearchParameters } from './models'
import { BUILD_VERSION } from './version'

const BASE_URL = 'https://astral-manga.fr'

export const AstralMangaInfo: SourceInfo = {
  name: 'Astral Manga',
  author: 'Paperback Community',
  description: 'French Astral Manga source for its UUID-based catalogue and public chapters.',
  contentRating: ContentRating.ADULT,
  icon: 'icon.png',
  version: BUILD_VERSION,
  websiteBaseURL: BASE_URL,
  language: 'French',
  sourceTags: [
    { text: 'French', type: BadgeColor.BLUE },
    { text: 'Manga', type: BadgeColor.GREEN },
    { text: 'Manhwa', type: BadgeColor.GREY }
  ],
  intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS
}

export class AstralManga implements Searchable, MangaProviding, ChapterProviding {
  private readonly parser = new AstralMangaParser(BASE_URL)
  private readonly interceptor: SourceInterceptor = {
    interceptRequest: async request => { request.headers = { ...request.headers, ...this.headers(request.url) }; return request },
    interceptResponse: async response => response
  }
  readonly requestManager: RequestManager = App.createRequestManager({ interceptor: this.interceptor, requestsPerSecond: 1, requestTimeout: 20000 })

  async getSearchResults(query: SearchRequest, metadata: unknown | undefined): Promise<PagedResults> {
    const page = (metadata as AstralMetadata | undefined)?.page ?? 1
    const parameters = this.parameters(query.parameters as AstralSearchParameters)
    const html = await this.requestText(this.parser.buildCatalogueUrl(page, query.title ?? '', query.includedTags, parameters))
    return this.parser.parseMangaList(html, page)
  }

  async getSearchTags(): Promise<TagSection[]> { return this.parser.parseSearchTags(await this.requestText(this.parser.buildCatalogueUrl(1))) }
  async getSearchFields(): Promise<SearchField[]> { return [
    App.createSearchField({ id: 'status', name: 'Statut', placeholder: 'En cours ou Termine' }),
    App.createSearchField({ id: 'type', name: 'Type', placeholder: 'Manga, Manhwa ou Manhua' }),
    App.createSearchField({ id: 'sort', name: 'Tri', placeholder: 'latest, popular ou alphabetical' })
  ] }
  async supportsTagExclusion(): Promise<boolean> { return false }
  async supportsSearchOperators(): Promise<boolean> { return false }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const info = this.parser.parseMangaDetails(mangaId, await this.requestText(this.parser.buildSeriesUrl(mangaId)))
    return App.createSourceManga({ id: mangaId, mangaInfo: info })
  }
  async getChapters(mangaId: string): Promise<Chapter[]> { return this.parser.parseChapters(mangaId, await this.requestText(this.parser.buildSeriesUrl(mangaId))) }
  async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> { return this.parser.parseChapterDetails(mangaId, chapterId, await this.requestText(this.parser.buildChapterUrl(mangaId, chapterId))) }
  getMangaShareUrl(mangaId: string): string { return this.parser.buildSeriesUrl(mangaId) }

  async getHomePageSections(callback: (section: HomeSection) => void): Promise<void> {
    const sections = [this.section(AstralHomeSectionId.Latest, 'Derniers ajouts'), this.section(AstralHomeSectionId.Popular, 'Populaires'), this.section(AstralHomeSectionId.Alphabetical, 'Catalogue A-Z')]
    for (const section of sections) callback(section)
    await Promise.all(sections.map(async section => {
      try {
        const results = await this.getViewMoreItems(section.id, { page: 1 })
        section.items = results.results; section.containsMoreItems = results.metadata !== undefined; callback(section)
      } catch (error) { console.log(`Astral Manga homepage section failed: ${section.id} ${String(error)}`) }
    }))
  }

  async getViewMoreItems(id: string, metadata: unknown | undefined): Promise<PagedResults> {
    const page = (metadata as AstralMetadata | undefined)?.page ?? 1
    const sort = id === AstralHomeSectionId.Popular ? 'popular' : id === AstralHomeSectionId.Alphabetical ? 'alphabetical' : 'latest'
    return this.parser.parseMangaList(await this.requestText(this.parser.buildCatalogueUrl(page, '', [], { sort })), page)
  }

  private section(id: AstralHomeSectionId, title: string): HomeSection { return App.createHomeSection({ id, title, type: HomeSectionType.singleRowNormal, items: [], containsMoreItems: true }) }
  private parameters(value: AstralSearchParameters): AstralSearchParameters {
    const status = (value.status ?? '').trim(); const type = (value.type ?? '').trim(); const sort = (value.sort ?? '').trim().toLowerCase()
    return { status: status || undefined, type: type || undefined, sort: ['latest', 'popular', 'alphabetical'].includes(sort) ? sort : undefined }
  }
  private async requestText(url: string): Promise<string> {
    let response: Response
    try { response = await this.requestManager.schedule(App.createRequest({ url, method: 'GET', headers: this.headers(url) }), 2) }
    catch (error) { throw new Error(`Astral Manga network request failed for ${url}: ${String(error)}`) }
    if (response.status < 200 || response.status >= 300) throw new Error(`Astral Manga request failed for ${url}: HTTP ${response.status}${response.status === 403 ? ' (Cloudflare challenge)' : ''}`)
    if (typeof response.data !== 'string') throw new Error(`Astral Manga returned an empty response for ${url}`)
    return response.data
  }
  private headers(url: string): Request['headers'] { return { referer: `${BASE_URL}/`, accept: /\.(?:jpg|jpeg|png|webp|avif)(?:[?#].*)?$/i.test(url) ? 'image/avif,image/webp,image/*,*/*;q=0.8' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'accept-language': 'fr-FR,fr;q=0.9', 'user-agent': 'Mozilla/5.0 Paperback/0.8 AstralManga' } }
}
