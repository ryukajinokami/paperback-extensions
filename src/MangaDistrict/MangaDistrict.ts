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
  SourceInfo,
  SourceIntents,
  SourceManga,
  Tag,
  TagSection
} from '@paperback/types'
import { MangaDistrictHomeSectionId, MangaDistrictSearchMetadata, MangaDistrictSearchParameters, MangaDistrictViewMoreMetadata } from './models'
import { MangaDistrictParser } from './MangaDistrictParser'

const BASE_URL = 'https://mangadistrict.com'

export const MangaDistrictInfo: SourceInfo = {
  name: 'MangaDistrict',
  author: 'Paperback Community',
  description: 'MangaDistrict source for Paperback v0.8. Supports search, details, chapters and reader pages.',
  contentRating: ContentRating.ADULT,
  icon: 'icon.png',
  version: '1.0.0',
  websiteBaseURL: BASE_URL,
  language: 'English',
  sourceTags: [
    { text: 'English', type: BadgeColor.BLUE },
    { text: 'Adult', type: BadgeColor.GREY },
    { text: 'Madara', type: BadgeColor.GREEN }
  ],
  intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS
}

export class MangaDistrict implements Searchable, MangaProviding, ChapterProviding {
  readonly requestManager: RequestManager = App.createRequestManager({
    requestsPerSecond: 2,
    requestTimeout: 20000
  })

  private readonly parser = new MangaDistrictParser(BASE_URL)

  async getSearchResults(query: SearchRequest, metadata: unknown | undefined): Promise<PagedResults> {
    const page = (metadata as MangaDistrictSearchMetadata | undefined)?.page ?? 1
    const orderBy = this.normalizeOrderBy((query.parameters as MangaDistrictSearchParameters).orderBy, query.title?.trim().length ? 'relevance' : 'modified')
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
      App.createHomeSection({
        id: MangaDistrictHomeSectionId.Latest,
        title: 'Latest Updates',
        type: HomeSectionType.singleRowNormal,
        items: [],
        containsMoreItems: true
      }),
      App.createHomeSection({
        id: MangaDistrictHomeSectionId.Popular,
        title: 'Most Viewed',
        type: HomeSectionType.singleRowNormal,
        items: [],
        containsMoreItems: true
      }),
      App.createHomeSection({
        id: MangaDistrictHomeSectionId.Trending,
        title: 'Trending',
        type: HomeSectionType.singleRowNormal,
        items: [],
        containsMoreItems: true
      }),
      App.createHomeSection({
        id: MangaDistrictHomeSectionId.NewSeries,
        title: 'New Series',
        type: HomeSectionType.singleRowNormal,
        items: [],
        containsMoreItems: true
      }),
      App.createHomeSection({
        id: MangaDistrictHomeSectionId.Rating,
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
        console.log(`MangaDistrict homepage section failed: ${section.id} ${String(error)}`)
      }
    }))
  }

  async getViewMoreItems(homepageSectionId: string, metadata: unknown | undefined): Promise<PagedResults> {
    const page = (metadata as MangaDistrictViewMoreMetadata | undefined)?.page ?? 1

    switch (homepageSectionId) {
      case MangaDistrictHomeSectionId.Latest:
        return this.getArchivePage('modified', page)
      case MangaDistrictHomeSectionId.Popular:
        return this.getArchivePage('views', page)
      case MangaDistrictHomeSectionId.Trending:
        return this.getArchivePage('trending', page)
      case MangaDistrictHomeSectionId.NewSeries:
        return this.getArchivePage('new-manga', page)
      case MangaDistrictHomeSectionId.Rating:
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
        console.log(`MangaDistrict tag exclusion skipped for ${result.mangaId}: ${String(error)}`)
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
      throw new Error(`MangaDistrict network request failed for ${url}: ${String(error)}`)
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`MangaDistrict request failed for ${url}: HTTP ${response.status}`)
    }

    if (typeof response.data !== 'string') {
      throw new Error(`MangaDistrict returned an empty response for ${url}`)
    }

    return response.data
  }

  private headers(url: string): Request['headers'] {
    return {
      referer: BASE_URL,
      origin: BASE_URL,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'user-agent': 'Paperback/0.8 MangaDistrict'
    }
  }
}
