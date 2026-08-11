import { Chapter, ChapterDetails, MangaInfo, PagedResults, PartialSourceManga, Tag, TagSection } from '@paperback/types'
import { MangaDistrictGenre } from './models'
import { createReaderError } from '../utils/readerError'
import { normalizeHttpUrl } from '../utils/url'
import { parseDateOrUndefined, parseFrenchDateOrUndefined } from '../utils/date'

const CARD_PAGE_SIZE = 30

export interface MadaraParserOptions {
  archivePath?: string
  seriesPath?: string
  genrePath?: string
  sourceName?: string
  langCode?: string
  hentai?: boolean
  acceptWordPressReaderImages?: boolean
  modernChapterContainerClass?: string
  modernChapterDateClass?: string
  modernAuthorLabel?: string
  modernArtistLabel?: string
}

export class MangaDistrictParser {
  private readonly options: Required<MadaraParserOptions>

  constructor(private readonly baseUrl: string, options: MadaraParserOptions = {}) {
    this.options = {
      archivePath: options.archivePath ?? 'series',
      seriesPath: options.seriesPath ?? 'series',
      genrePath: options.genrePath ?? 'publication-genre',
      sourceName: options.sourceName ?? 'MangaDistrict',
      langCode: options.langCode ?? 'en',
      hentai: options.hentai ?? true,
      acceptWordPressReaderImages: options.acceptWordPressReaderImages ?? false,
      modernChapterContainerClass: options.modernChapterContainerClass ?? '',
      modernChapterDateClass: options.modernChapterDateClass ?? '',
      modernAuthorLabel: options.modernAuthorLabel ?? '',
      modernArtistLabel: options.modernArtistLabel ?? ''
    }
  }

  parseMangaList(html: string, page: number): PagedResults {
    const results = this.parseMangaCards(html)

    return App.createPagedResults({
      results,
      metadata: this.hasNextPage(html, results.length, page) ? { page: page + 1 } : undefined
    })
  }

  parseMangaDetails(mangaId: string, html: string): MangaInfo {
    const title = this.extractSeriesTitle(html) || this.titleFromSlug(mangaId)
    const alternativeTitles = this.splitTitles(this.extractLabeledSummary(html, 'Alternative'))
    const cover = this.extractCover(html)
    const genres = this.parseGenresFromDetails(html)
    const status = this.extractLabeledSummary(html, 'Status') || this.extractModernInfo(html, 'Statut') || 'Unknown'

    return App.createMangaInfo({
      image: cover,
      titles: Array.from(new Set([title, ...alternativeTitles])),
      author: this.extractNamedContent(html, 'author-content')
        || this.extractConfiguredModernInfo(html, this.options.modernAuthorLabel)
        || this.extractModernAuthor(html)
        || 'Unknown',
      artist: this.extractNamedContent(html, 'artist-content')
        || this.extractConfiguredModernInfo(html, this.options.modernArtistLabel)
        || 'Unknown',
      desc: this.extractDescription(html),
      status,
      hentai: this.options.hentai,
      rating: this.extractRating(html),
      tags: [this.toTagSection(genres)],
      covers: cover.length > 0 ? [cover] : [],
      additionalInfo: this.seriesAdditionalInfo(html)
    })
  }

  parseChapters(mangaId: string, html: string): Chapter[] {
    const chapters: Chapter[] = []
    const seen: Record<string, boolean> = {}
    const chapterPattern = /<li[^>]+class=["'][^"']*wp-manga-chapter[^"']*["'][\s\S]*?<\/li>/gi
    let match: RegExpExecArray | null

    while ((match = chapterPattern.exec(html)) !== null) {
      const block = match[0]
      const href = this.extractAttribute(block, 'href')
      const chapterId = this.chapterIdFromUrl(href)

      if (!chapterId || seen[chapterId]) {
        continue
      }

      seen[chapterId] = true
      const name = this.cleanText(this.extractAnchorText(block) || this.titleFromSlug(chapterId))
      const chapNum = this.chapterNumber(chapterId, name)
      const time = this.parseChapterDate(block)

      chapters.push(App.createChapter({
        id: chapterId,
        chapNum,
        name,
        langCode: this.options.langCode,
        group: this.options.sourceName,
        ...(time ? { time } : {}),
        sortingIndex: chapNum
      }))
    }

    const escapedMangaId = this.escapeRegExp(encodeURIComponent(mangaId))
    const modernChapterPattern = new RegExp(`<a[^>]+href=["']([^"']*/${this.escapeRegExp(this.options.seriesPath)}/${escapedMangaId}/([^/"'#?]+)/?)["'][^>]*>([\\s\\S]*?)<\\/a>`, 'gi')

    while ((match = modernChapterPattern.exec(html)) !== null) {
      const chapterId = this.decodeText(match[2] ?? '')
      if (!/^chap(?:ter|itre)-/i.test(chapterId) || seen[chapterId]) {
        continue
      }

      seen[chapterId] = true
      const rawName = this.cleanHtml(match[3] ?? '') || this.titleFromSlug(chapterId)
      const name = /^\d+(?:\.\d+)?$/.test(rawName)
        ? `${this.options.langCode === 'fr' ? 'Chapitre' : 'Chapter'} ${rawName}`
        : rawName
      const chapNum = this.chapterNumber(chapterId, name)
      const time = this.parseModernChapterDate(html, match.index)

      chapters.push(App.createChapter({
        id: chapterId,
        chapNum,
        name,
        langCode: this.options.langCode,
        group: this.options.sourceName,
        ...(time ? { time } : {}),
        sortingIndex: chapNum
      }))
    }

    return chapters.sort((left, right) => left.chapNum - right.chapNum)
  }

  parseChapterRange(mangaId: string, html: string): Chapter[] {
    const visibleChapters = this.parseChapters(mangaId, html)
    const highestChapter = visibleChapters.reduce((highest, chapter) => Math.max(highest, Math.floor(chapter.chapNum)), 0)

    if (highestChapter <= 0) {
      return visibleChapters
    }

    const prefix = visibleChapters.find(chapter => /^chap(?:ter|itre)-/i.test(chapter.id))?.id.split(/\d/)[0] ?? 'chapter-'
    const seen = new Set(visibleChapters.map(chapter => chapter.id))

    for (let chapterNumber = 1; chapterNumber <= highestChapter; chapterNumber += 1) {
      const chapterId = `${prefix}${chapterNumber}`
      if (seen.has(chapterId)) {
        continue
      }

      visibleChapters.push(App.createChapter({
        id: chapterId,
        chapNum: chapterNumber,
        name: `${this.options.langCode === 'fr' ? 'Chapitre' : 'Chapter'} ${chapterNumber}`,
        langCode: this.options.langCode,
        group: this.options.sourceName,
        sortingIndex: chapterNumber
      }))
    }

    return visibleChapters.sort((left, right) => left.chapNum - right.chapNum)
  }

  parseChapterDetails(mangaId: string, chapterId: string, html: string): ChapterDetails {
    const pages = this.extractReaderImages(html)

    if (pages.length === 0) {
      throw createReaderError(this.options.sourceName, mangaId, chapterId, html)
    }

    return App.createChapterDetails({
      id: chapterId,
      mangaId,
      pages
    })
  }

  parseSearchTags(html: string): TagSection[] {
    const seen: Record<string, MangaDistrictGenre> = {}
    const genrePath = this.escapeRegExp(this.options.genrePath)
    const tagPattern = new RegExp(`<a[^>]+href=["'][^"']*/${genrePath}/([^/"'#?]+)/?["'][^>]*>([\\s\\S]*?)<\\/a>`, 'gi')
    let match: RegExpExecArray | null

    while ((match = tagPattern.exec(html)) !== null) {
      const id = this.cleanText(match[1] ?? '')
      const label = this.cleanText((match[2] ?? '').replace(/<span[\s\S]*?<\/span>/gi, ''))

      if (id.length === 0 || label.length === 0) {
        continue
      }

      const existing = seen[id]
      if (!existing || this.isAllCaps(existing.label) && !this.isAllCaps(label)) {
        seen[id] = { id, label }
      }
    }

    const modernTagPattern = /<label[^>]+class=["'][^"']*ori-fcheck[^"']*["'][^>]*>[\s\S]*?<input[^>]+value=["']([^"']+)["'][^>]*>[\s\S]*?<span[^>]+class=["'][^"']*ori-flabel[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/label>/gi
    while ((match = modernTagPattern.exec(html)) !== null) {
      const id = this.cleanText(match[1] ?? '')
      const label = this.cleanHtml(match[2] ?? '')

      if (id.length > 0 && label.length > 0) {
        seen[id] = { id, label }
      }
    }

    const tags = Object.values(seen)
      .sort((left, right) => left.label.localeCompare(right.label))
      .map(genre => App.createTag({ id: genre.id, label: genre.label }))

    return [
      App.createTagSection({
        id: 'genres',
        label: 'Genres',
        tags
      })
    ]
  }

  parseGenreIdsFromDetails(html: string): string[] {
    return this.parseGenresFromDetails(html).map(genre => genre.id)
  }

  buildSearchUrl(title: string, page: number, orderBy: string, includedTagIds: string[]): string {
    const parameters: Array<[string, string]> = [
      ['s', title],
      ['post_type', 'wp-manga'],
      ...includedTagIds.map(tagId => ['genre[]', tagId] as [string, string])
    ]

    if (orderBy !== 'relevance') {
      parameters.push(['m_orderby', orderBy])
    }

    if (page > 1) {
      parameters.push(['paged', String(page)])
    }

    return this.buildUrl('/', parameters)
  }

  buildArchiveUrl(orderBy: string, page: number, includedTagIds: string[] = []): string {
    const path = page > 1 ? `/${this.options.archivePath}/page/${page}/` : `/${this.options.archivePath}/`

    return this.buildUrl(path, [
      ['m_orderby', orderBy],
      ...includedTagIds.map(tagId => ['genre[]', tagId] as [string, string])
    ])
  }

  buildSeriesUrl(mangaId: string): string {
    return `${this.baseUrl}/${this.options.seriesPath}/${encodeURIComponent(mangaId)}/`
  }

  buildChapterUrl(mangaId: string, chapterId: string): string {
    return `${this.buildSeriesUrl(mangaId)}${encodeURIComponent(chapterId)}/`
  }

  buildChaptersUrl(mangaId: string, page = 1): string {
    return `${this.buildSeriesUrl(mangaId)}ajax/chapters/?t=${page}&paperback=1`
  }

  mangaIdFromUrl(url: string): string | undefined {
    const path = this.escapeRegExp(this.options.seriesPath)
    const match = new RegExp(`/${path}/([^/?#]+)/?(?:[?#].*)?$`).exec(url)
    return match?.[1] ? this.decodeText(match[1]) : undefined
  }

  normalizeUrl(value: string): string {
    return normalizeHttpUrl(this.decodeText(value), this.baseUrl)
  }

  private parseMangaCards(html: string): PartialSourceManga[] {
    const legacyBlocks = html.split(/<div[^>]+class=["'][^"']*page-item-detail[^"']*manga[^"']*["'][^>]*>/i).slice(1)
    const modernBlocks = html.match(/<a[^>]+class=["'][^"']*ori-cat-card[^"']*["'][^>]*>[\s\S]*?<\/a>/gi) ?? []
    const blocks = [...legacyBlocks, ...modernBlocks]
    const seen: Record<string, boolean> = {}
    const results: PartialSourceManga[] = []

    for (const rawBlock of blocks) {
      const block = rawBlock.slice(0, 6000)
      const href = this.extractSeriesHref(block)
      const mangaId = href ? this.mangaIdFromUrl(href) : undefined

      if (!mangaId || seen[mangaId]) {
        continue
      }

      seen[mangaId] = true
      const image = this.extractCardImage(block)
      const title = this.extractCardTitle(block) || this.titleFromSlug(mangaId)
      const subtitle = this.extractCardSubtitle(block)

      results.push(App.createPartialSourceManga({
        mangaId,
        title,
        image,
        subtitle
      }))
    }

    if (results.length === 0) {
      const canonical = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i.exec(html)?.[1] ?? ''
      const mangaId = this.mangaIdFromUrl(this.normalizeUrl(canonical))

      if (mangaId) {
        results.push(App.createPartialSourceManga({
          mangaId,
          title: this.extractSeriesTitle(html) || this.titleFromSlug(mangaId),
          image: this.extractCover(html)
        }))
      }
    }

    return results
  }

  private extractSeriesHref(block: string): string {
    const path = this.escapeRegExp(this.options.seriesPath)
    const match = new RegExp("<a[^>]+href=[\"']([^\"']*/" + path + "/[^/\"'#?]+/?)[\"'][^>]*>", 'i').exec(block)
    return this.normalizeUrl(match?.[1] ?? '')
  }

  private extractCardTitle(block: string): string {
    const modernTitle = /<span[^>]+class=["'][^"']*ori-card-title[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(block)
    if (modernTitle?.[1]) {
      return this.cleanHtml(modernTitle[1])
    }

    const titleAnchor = /<div[^>]+class=["'][^"']*post-title[^"']*["'][\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i.exec(block)
    if (titleAnchor?.[1]) {
      return this.cleanHtml(titleAnchor[1])
    }

    const path = this.escapeRegExp(this.options.seriesPath)
    const titleAttr = new RegExp("<a[^>]+href=[\"'][^\"']*/" + path + "/[^\"']+[\"'][^>]*title=[\"']([^\"']+)[\"'][^>]*>", 'i').exec(block)
    if (titleAttr?.[1]) {
      return this.cleanText(titleAttr[1])
    }

    const imageAlt = /<img[^>]+alt=["']([^"']+)["'][^>]*>/i.exec(block)
    return this.cleanText(imageAlt?.[1] ?? '')
  }

  private extractCardImage(block: string): string {
    const imageTag = /<img[^>]+>/i.exec(block)?.[0] ?? ''
    return this.firstImageUrl(imageTag)
  }

  private extractCardSubtitle(block: string): string | undefined {
    const modernSubtitle = /<span[^>]+class=["'][^"']*ori-card-sub[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(block)
    if (modernSubtitle?.[1]) {
      return this.cleanHtml(modernSubtitle[1])
    }

    const latestChapter = /<div[^>]+class=["'][^"']*chapter-item[^"']*["'][\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i.exec(block)
    const score = /<span[^>]+class=["'][^"']*total_votes[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(block)
    const parts = [
      latestChapter?.[1] ? this.cleanHtml(latestChapter[1]) : undefined,
      score?.[1] ? `Rating ${this.cleanHtml(score[1])}` : undefined
    ].filter((part): part is string => typeof part === 'string' && part.length > 0)

    return parts.length > 0 ? parts.join(' | ') : undefined
  }

  private extractSeriesTitle(html: string): string {
    const titleBlock = /<div[^>]+class=["'][^"']*post-title[^"']*["'][\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
    if (titleBlock?.[1]) {
      return this.cleanHtml(titleBlock[1])
    }

    const ogTitle = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i.exec(html)
    if (ogTitle?.[1]) {
      return this.cleanText(ogTitle[1].replace(/\s+-\s+MANGA DISTRICT[\s\S]*$/i, ''))
    }

    return ''
  }

  private extractCover(html: string): string {
    const summaryImage = /<div[^>]+class=["'][^"']*summary_image[^"']*["'][\s\S]*?<\/div>/i.exec(html)?.[0] ?? ''
    const imageTag = /<img[^>]+>/i.exec(summaryImage)?.[0] ?? ''
    const image = this.firstImageUrl(imageTag)

    if (image.length > 0) {
      return image
    }

    const ogImage = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i.exec(html)
    return this.normalizeUrl(ogImage?.[1] ?? '')
  }

  private extractDescription(html: string): string {
    const description = /<div[^>]+class=["'][^"']*description-summary[^"']*["'][\s\S]*?<div[^>]+class=["'][^"']*summary__content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html)
    if (description?.[1]) {
      return this.cleanHtml(description[1])
    }

    const modernDescription = /<div[^>]+class=["'][^"']*ori-sr-syn-texte[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html)
    if (modernDescription?.[1]) {
      return this.cleanHtml(modernDescription[1])
    }

    const metaDescription = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i.exec(html)
    return this.cleanText(metaDescription?.[1] ?? '')
  }

  private parseGenresFromDetails(html: string): MangaDistrictGenre[] {
    const genresBlock = /<div[^>]+class=["'][^"']*genres-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1]
      ?? /<div[^>]+class=["'][^"']*ori-sr-genres[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1]
      ?? ''
    const genres: MangaDistrictGenre[] = []
    const genrePath = this.escapeRegExp(this.options.genrePath)
    const genrePattern = new RegExp("<a[^>]+href=[\"'][^\"']*/" + genrePath + "/([^/\"'#?]+)/?[\"'][^>]*>([\\s\\S]*?)<\\/a>", 'gi')
    let match: RegExpExecArray | null

    while ((match = genrePattern.exec(genresBlock)) !== null) {
      const id = this.cleanText(match[1] ?? '')
      const label = this.cleanHtml(match[2] ?? '')

      if (id.length > 0 && label.length > 0) {
        genres.push({ id, label })
      }
    }

    return genres
  }

  private extractNamedContent(html: string, className: string): string {
    const escaped = this.escapeRegExp(className)
    const content = new RegExp(`<div[^>]+class=["'][^"']*${escaped}[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>`, 'i').exec(html)
    return this.cleanHtml(content?.[1] ?? '')
  }

  private extractLabeledSummary(html: string, label: string): string {
    const escaped = this.escapeRegExp(label)
    const pattern = new RegExp(`<h5>\\s*${escaped}\\s*<\\/h5>\\s*<\\/div>\\s*<div[^>]+class=["'][^"']*summary-content[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>`, 'i')

    return this.cleanHtml(pattern.exec(html)?.[1] ?? '')
  }

  private extractRating(html: string): number | undefined {
    const value = /<span[^>]+class=["'][^"']*total_votes[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(html)?.[1]
    const rating = Number(this.cleanHtml(value ?? ''))

    return Number.isFinite(rating) ? rating : undefined
  }

  private extractModernAuthor(html: string): string {
    const signature = /<div[^>]+class=["'][^"']*ori-sr-signature[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html)
    return this.cleanHtml(signature?.[1] ?? '')
  }

  private extractModernInfo(html: string, label: string): string {
    const expectedLabel = this.normalizeInfoLabel(label)
    const pattern = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi
    let match: RegExpExecArray | null

    while ((match = pattern.exec(html)) !== null) {
      if (this.normalizeInfoLabel(match[1] ?? '') === expectedLabel) {
        return this.cleanHtml(match[2] ?? '')
      }
    }

    return ''
  }

  private extractConfiguredModernInfo(html: string, label: string): string {
    return label.length > 0 ? this.extractModernInfo(html, label) : ''
  }

  private normalizeInfoLabel(value: string): string {
    return this.cleanHtml(value)
      .replace(/&eacute;/gi, 'e')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  }

  private seriesAdditionalInfo(html: string): Record<string, string> {
    const info: Record<string, string> = {}
    const fields = ['Type', 'Release', 'Status']

    for (const field of fields) {
      const modernLabel = field === 'Status' ? 'Statut' : field
      const value = this.extractLabeledSummary(html, field) || this.extractModernInfo(html, modernLabel)
      if (value.length > 0) info[field] = value
    }

    return info
  }

  private splitTitles(value: string): string[] {
    return value
      .split(/[|;,]/)
      .map(title => this.cleanText(title))
      .filter(title => title.length > 0 && title.toLowerCase() !== 'n/a')
  }

  private extractReaderImages(html: string): string[] {
    const readerHtml = this.extractReaderHtml(html)
    const imagePattern = /<img[^>]+class=["'][^"']*wp-manga-chapter-img[^"']*["'][^>]*>/gi
    const seen: Record<string, boolean> = {}
    const pages: string[] = []
    let match: RegExpExecArray | null

    while ((match = imagePattern.exec(readerHtml)) !== null) {
      const url = this.firstImageUrl(match[0])

      if (!this.isReaderPageImage(url) || seen[url]) {
        continue
      }

      seen[url] = true
      pages.push(url)
    }

    return pages
  }

  private extractReaderHtml(html: string): string {
    const start = html.search(/<div[^>]+class=["'][^"']*reading-content[^"']*["'][^>]*>/i)
    if (start < 0) {
      return html
    }

    const rest = html.slice(start)
    const end = rest.search(/<div[^>]+class=["'][^"']*(comments-area|related-manga|c-sidebar|site-footer)[^"']*["'][^>]*>/i)

    return end > 0 ? rest.slice(0, end) : rest
  }

  private firstImageUrl(imageTag: string): string {
    const attributes = ['data-mature-static', 'data-default-src', 'data-src', 'data-lazy-src', 'src']

    for (const attribute of attributes) {
      const value = this.extractAttribute(imageTag, attribute)
      const url = this.normalizeUrl(value)

      if (url.length > 0) {
        return url
      }
    }

    return ''
  }

  private isReaderPageImage(url: string): boolean {
    if (url.length === 0) {
      return false
    }

    const lower = url.toLowerCase()

    if (!/\.(?:jpg|jpeg|png|webp|gif|avif)(?:[?#].*)?$/.test(lower)) {
      return false
    }

    if (lower.includes('/thumbnail/') || lower.includes('/logo') || lower.includes('/favicon') || lower.includes('/banner')) {
      return false
    }

    if (this.options.acceptWordPressReaderImages) return lower.includes('/wp-content/uploads/')
    if (lower.includes('/assets/publication/media/') || lower.includes('/wp-content/')) return false

    return lower.includes('cdn.mangadistrict.com/publication/') && lower.includes('/chapter-')
  }

  private chapterIdFromUrl(url: string): string | undefined {
    const path = this.escapeRegExp(this.options.seriesPath)
    const match = new RegExp('/' + path + '/[^/]+/([^/?#]+)/?(?:[?#].*)?$').exec(url)
    return match?.[1] ? this.decodeText(match[1]) : undefined
  }

  private extractAnchorText(block: string): string {
    const anchor = /<a[^>]*>([\s\S]*?)<\/a>/i.exec(block)
    return anchor?.[1] ? this.cleanHtml(anchor[1]) : ''
  }

  private chapterNumber(chapterId: string, title: string): number {
    const titleMatch = /chapter\s+(\d+(?:\.\d+)?)/i.exec(title)
    if (titleMatch?.[1]) {
      return Number(titleMatch[1])
    }

    const slugMatch = /chap(?:ter|itre)-(\d+(?:-\d+)?)/i.exec(chapterId)
    if (!slugMatch?.[1]) {
      return 0
    }

    const parts = slugMatch[1].split('-')
    if (parts.length === 1) {
      return Number(parts[0])
    }

    return Number(`${parts[0]}.${parts.slice(1).join('')}`)
  }

  private parseChapterDate(block: string): Date | undefined {
    const dateText = /<span[^>]+class=["'][^"']*timediff[^"']*["'][^>]*>[\s\S]*?<i[^>]*>([\s\S]*?)<\/i>/i.exec(block)?.[1] ?? ''
    return parseDateOrUndefined(this.cleanHtml(dateText))
  }

  private parseModernChapterDate(html: string, chapterIndex: number): Date | undefined {
    const containerClass = this.options.modernChapterContainerClass
    const dateClass = this.options.modernChapterDateClass
    if (!containerClass || !dateClass) {
      return undefined
    }

    const containerPattern = new RegExp(`<[^>]+class=["'][^"']*\\b${this.escapeRegExp(containerClass)}\\b[^"']*["'][^>]*>`, 'gi')
    let container: RegExpExecArray | null
    let start = -1
    let end = html.length

    while ((container = containerPattern.exec(html)) !== null) {
      if (container.index > chapterIndex) {
        end = container.index
        break
      }
      start = container.index
    }

    if (start < 0) {
      return undefined
    }

    const block = html.slice(start, end)
    const datePattern = new RegExp(`<[^>]+class=["'][^"']*\\b${this.escapeRegExp(dateClass)}\\b[^"']*["'][^>]*>[\\s\\S]*?<\\/[^>]+>`, 'i')
    const dateElement = datePattern.exec(block)?.[0]
    if (!dateElement) {
      return undefined
    }

    const dateValue = this.extractAttribute(dateElement, 'datetime') || this.cleanHtml(dateElement)
    return parseFrenchDateOrUndefined(dateValue)
  }

  private hasNextPage(html: string, resultCount: number, page: number): boolean {
    if (resultCount === 0) {
      return false
    }

    const nextPagePattern = new RegExp(`title=["']Page\\s+${page + 1}["']|/page/${page + 1}/|[?&]paged=${page + 1}\\b`, 'i')
    return nextPagePattern.test(html) || resultCount >= CARD_PAGE_SIZE
  }

  private toTagSection(genres: MangaDistrictGenre[]): TagSection {
    const tags = genres.map(genre => App.createTag({
      id: genre.id,
      label: genre.label
    }))

    return App.createTagSection({
      id: 'genres',
      label: 'Genres',
      tags
    })
  }

  private buildUrl(path: string, parameters: Array<[string, string]>): string {
    const query = parameters
      .filter(([, value]) => value.trim().length > 0)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&')

    return `${this.baseUrl}${path}${query.length > 0 ? `?${query}` : ''}`
  }

  private extractAttribute(html: string, attribute: string): string {
    const escaped = this.escapeRegExp(attribute)
    const match = new RegExp(`${escaped}\\s*=\\s*["']([^"']+)["']`, 'i').exec(html)

    return this.decodeText(match?.[1] ?? '')
  }

  private titleFromSlug(slug: string): string {
    return slug
      .split('-')
      .filter(part => part.length > 0)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  }

  private cleanHtml(value: string): string {
    return this.cleanText(value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ''))
  }

  private cleanText(value: string): string {
    return this.decodeText(value)
      .replace(/\s+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  }

  private decodeText(value: string): string {
    return value
      .replace(/\\u002F/g, '/')
      .replace(/\\u003c/gi, '<')
      .replace(/\\u003e/gi, '>')
      .replace(/\\u0026/gi, '&')
      .replace(/\\u0022/gi, '"')
      .replace(/\\u0027/gi, "'")
      .replace(/\\n/g, '\n')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&rsquo;/g, "'")
      .replace(/&ldquo;/g, '"')
      .replace(/&rdquo;/g, '"')
      .replace(/&hellip;/g, '...')
      .replace(/&middot;/g, '\u00b7')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#8211;/g, '-')
      .replace(/&#8217;/g, "'")
      .replace(/&#8220;/g, '"')
      .replace(/&#8221;/g, '"')
  }

  private isAllCaps(value: string): boolean {
    const letters = value.replace(/[^A-Za-z]/g, '')
    return letters.length > 0 && letters === letters.toUpperCase()
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}
