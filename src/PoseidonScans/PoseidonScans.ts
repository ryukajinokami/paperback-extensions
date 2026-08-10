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
import { PoseidonHomeSectionId, PoseidonSearchMetadata, PoseidonSearchParameters, PoseidonViewMoreMetadata } from './models'
import { PoseidonScansParser } from './PoseidonScansParser'
import { BUILD_VERSION } from './version'

const BASE_URL = 'https://poseidon-scans.net'

export const PoseidonScansInfo: SourceInfo = {
  name: 'Poseidon Scans',
  author: 'Paperback Community',
  description: 'Poseidon Scans source for Paperback v0.8. Supports French catalogue search, details, free chapters and reader pages.',
  contentRating: ContentRating.MATURE,
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

export class PoseidonScans implements Searchable, MangaProviding, ChapterProviding {
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

  private readonly parser = new PoseidonScansParser(BASE_URL)

  async getSearchResults(query: SearchRequest, metadata: unknown | undefined): Promise<PagedResults> {
    const page = (metadata as PoseidonSearchMetadata | undefined)?.page ?? 1
    const filters = this.parser.splitSearchTags(query.includedTags)
    const parameters = this.normalizeSearchParameters(query.parameters as PoseidonSearchParameters)
    if (!filters.status && parameters.status) filters.status = parameters.status
    const html = await this.requestText(this.parser.buildSearchUrl(query.title ?? '', page, filters, parameters))

    return this.parser.parseMangaList(html, page)
  }

  async getSearchTags(): Promise<TagSection[]> {
    const html = await this.requestText(this.parser.buildCatalogueUrl(1))
    return this.parser.parseSearchTags(html)
  }

  async getSearchFields(): Promise<SearchField[]> {
    return [
      App.createSearchField({
        id: 'status',
        name: 'Statut',
        placeholder: 'en cours, terminé, en pause ou annulé'
      }),
      App.createSearchField({
        id: 'sortBy',
        name: 'Trier par',
        placeholder: 'latest_chapter, most_chapters, popular, alpha ou recent'
      }),
      App.createSearchField({
        id: 'minChapters',
        name: 'Chapitres minimum',
        placeholder: '0'
      }),
      App.createSearchField({
        id: 'maxChapters',
        name: 'Chapitres maximum',
        placeholder: '500'
      })
    ]
  }

  async supportsTagExclusion(): Promise<boolean> {
    return false
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
    const html = await this.requestText(this.parser.buildSeriesUrl(mangaId))

    return this.parser.parseChapters(mangaId, html)
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
      this.homeSection(PoseidonHomeSectionId.LatestChapters, 'Derniers chapitres'),
      this.homeSection(PoseidonHomeSectionId.Popular, 'Populaires'),
      this.homeSection(PoseidonHomeSectionId.NewSeries, 'Nouvelles séries'),
      this.homeSection(PoseidonHomeSectionId.Catalogue, 'Catalogue')
    ]

    for (const section of sections) sectionCallback(section)

    await Promise.all(sections.map(async section => {
      try {
        const results = await this.getViewMoreItems(section.id, { page: 1 })
        section.items = results.results
        section.containsMoreItems = results.metadata !== undefined
        sectionCallback(section)
      } catch (error) {
        console.log(`Poseidon Scans homepage section failed: ${section.id} ${String(error)}`)
      }
    }))
  }

  async getViewMoreItems(homepageSectionId: string, metadata: unknown | undefined): Promise<PagedResults> {
    const page = (metadata as PoseidonViewMoreMetadata | undefined)?.page ?? 1

    switch (homepageSectionId) {
      case PoseidonHomeSectionId.LatestChapters:
        return this.getCataloguePage(page, 'latest_chapter')
      case PoseidonHomeSectionId.Popular:
        return this.getCataloguePage(page, 'popular')
      case PoseidonHomeSectionId.NewSeries:
        return this.getCataloguePage(page, 'recent')
      case PoseidonHomeSectionId.Catalogue:
        return this.getCataloguePage(page)
      default:
        return App.createPagedResults({ results: [] })
    }
  }

  private async getCataloguePage(page: number, sortBy?: string): Promise<PagedResults> {
    const html = await this.requestText(this.parser.buildCatalogueUrl(page, sortBy))

    return this.parser.parseMangaList(html, page)
  }

  private homeSection(id: PoseidonHomeSectionId, title: string): HomeSection {
    return App.createHomeSection({
      id,
      title,
      type: HomeSectionType.singleRowNormal,
      items: [],
      containsMoreItems: true
    })
  }

  private normalizeSearchParameters(parameters: PoseidonSearchParameters): PoseidonSearchParameters {
    const allowedStatuses = ['en cours', 'terminé', 'en pause', 'annulé']
    const allowedSorts = ['latest_chapter', 'most_chapters', 'popular', 'alpha', 'recent']
    const status = (parameters.status ?? '').trim().toLowerCase()
    const sortBy = (parameters.sortBy ?? '').trim().toLowerCase()

    return {
      status: allowedStatuses.includes(status) ? status : undefined,
      sortBy: allowedSorts.includes(sortBy) ? sortBy : undefined,
      minChapters: this.normalizeChapterLimit(parameters.minChapters),
      maxChapters: this.normalizeChapterLimit(parameters.maxChapters)
    }
  }

  private normalizeChapterLimit(value: string | undefined): string | undefined {
    if (!value?.trim()) return undefined
    const number = Math.max(0, Math.min(500, Math.round(Number(value))))
    return Number.isFinite(number) ? String(number) : undefined
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
      throw new Error(`Poseidon Scans network request failed for ${url}: ${String(error)}`)
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Poseidon Scans request failed for ${url}: HTTP ${response.status}`)
    }

    if (typeof response.data !== 'string') {
      throw new Error(`Poseidon Scans returned an empty response for ${url}`)
    }

    return response.data
  }

  private headers(url: string): Request['headers'] {
    const imageRequest = this.isImageRequest(url)

    return {
      referer: `${BASE_URL}/`,
      origin: BASE_URL,
      accept: imageRequest ? 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
    }
  }

  private isImageRequest(url: string): boolean {
    return /\.(?:jpg|jpeg|png|webp|gif)(?:[?#].*)?$/i.test(url)
      || /\/api\/(?:chapters|covers|banners|banners-bg|banners-character|avatar)\//i.test(url)
      || /\/_next\/image\?/i.test(url)
  }
}
