import { Chapter, ChapterDetails, MangaInfo, PagedResults, PartialSourceManga, Tag, TagSection } from '@paperback/types'
import { MangaDistrictGenre } from './models'

const CARD_PAGE_SIZE = 30

export class MangaDistrictParser {
  constructor(private readonly baseUrl: string) {}

  parseMangaList(html: string, page: number): PagedResults {
    const results = this.parseMangaCards(html)

    return App.createPagedResults({
      results,
      metadata: this.hasNextPage(html, results.length, page) ? { page: page + 1 } : undefined
    })
  }

  parseMangaDetails(mangaId: string, html: string): MangaInfo {
    const title = this.extractSeriesTitle(html) || this.titleFromSlug(mangaId)
    const cover = this.extractCover(html)
    const genres = this.parseGenresFromDetails(html)
    const status = this.extractLabeledSummary(html, 'Status') || 'Unknown'

    return App.createMangaInfo({
      image: cover,
      titles: [title],
      author: this.extractNamedContent(html, 'author-content') || 'Unknown',
      artist: this.extractNamedContent(html, 'artist-content') || 'Unknown',
      desc: this.extractDescription(html),
      status,
      hentai: true,
      rating: this.extractRating(html),
      tags: [this.toTagSection(genres)],
      covers: cover.length > 0 ? [cover] : []
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

      chapters.push(App.createChapter({
        id: chapterId,
        chapNum,
        name,
        langCode: 'en',
        group: 'MangaDistrict',
        time: this.parseChapterDate(block),
        sortingIndex: chapNum
      }))
    }

    return chapters.sort((left, right) => left.chapNum - right.chapNum)
  }

  parseChapterDetails(mangaId: string, chapterId: string, html: string): ChapterDetails {
    const pages = this.extractReaderImages(html)

    if (pages.length === 0) {
      throw new Error(`No readable MangaDistrict pages found for ${mangaId}/${chapterId}`)
    }

    return App.createChapterDetails({
      id: chapterId,
      mangaId,
      pages
    })
  }

  parseSearchTags(html: string): TagSection[] {
    const seen: Record<string, MangaDistrictGenre> = {}
    const tagPattern = /<a[^>]+href=["']https?:\/\/(?:www\.)?mangadistrict\.com\/publication-genre\/([^/"'#?]+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi
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
    const path = page > 1 ? `/series/page/${page}/` : '/series/'

    return this.buildUrl(path, [
      ['m_orderby', orderBy],
      ...includedTagIds.map(tagId => ['genre[]', tagId] as [string, string])
    ])
  }

  buildSeriesUrl(mangaId: string): string {
    return `${this.baseUrl}/series/${encodeURIComponent(mangaId)}/`
  }

  buildChapterUrl(mangaId: string, chapterId: string): string {
    return `${this.buildSeriesUrl(mangaId)}${encodeURIComponent(chapterId)}/`
  }

  mangaIdFromUrl(url: string): string | undefined {
    const match = /\/series\/([^/?#]+)\/?(?:[?#].*)?$/.exec(url)
    return match?.[1] ? this.decodeText(match[1]) : undefined
  }

  normalizeUrl(value: string): string {
    const cleaned = this.decodeText(value.trim()).replace(/\\\//g, '/')

    if (cleaned.length === 0 || cleaned.startsWith('data:')) {
      return ''
    }

    if (cleaned.startsWith('//')) {
      return `https:${cleaned}`
    }

    if (cleaned.startsWith('/')) {
      return `${this.baseUrl}${cleaned}`
    }

    return cleaned
  }

  private parseMangaCards(html: string): PartialSourceManga[] {
    const blocks = html.split(/<div[^>]+class=["'][^"']*page-item-detail[^"']*manga[^"']*["'][^>]*>/i).slice(1)
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

    return results
  }

  private extractSeriesHref(block: string): string {
    const match = /<a[^>]+href=["']([^"']*\/series\/[^/"'#?]+\/?)["'][^>]*>/i.exec(block)
    return this.normalizeUrl(match?.[1] ?? '')
  }

  private extractCardTitle(block: string): string {
    const titleAnchor = /<div[^>]+class=["'][^"']*post-title[^"']*["'][\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i.exec(block)
    if (titleAnchor?.[1]) {
      return this.cleanHtml(titleAnchor[1])
    }

    const titleAttr = /<a[^>]+href=["'][^"']*\/series\/[^"']+["'][^>]*title=["']([^"']+)["'][^>]*>/i.exec(block)
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

    const metaDescription = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i.exec(html)
    return this.cleanText(metaDescription?.[1] ?? '')
  }

  private parseGenresFromDetails(html: string): MangaDistrictGenre[] {
    const genresBlock = /<div[^>]+class=["'][^"']*genres-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1] ?? ''
    const genres: MangaDistrictGenre[] = []
    const genrePattern = /<a[^>]+href=["'][^"']*\/publication-genre\/([^/"'#?]+)\/?["'][^>]*>([\s\S]*?)<\/a>/gi
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

    if (!/\.(?:jpg|jpeg|png|webp|gif)(?:[?#].*)?$/.test(lower)) {
      return false
    }

    if (lower.includes('/assets/publication/media/') || lower.includes('/thumbnail/') || lower.includes('/wp-content/')) {
      return false
    }

    return lower.includes('cdn.mangadistrict.com/publication/') && lower.includes('/chapter-')
  }

  private chapterIdFromUrl(url: string): string | undefined {
    const match = /\/series\/[^/]+\/([^/?#]+)\/?(?:[?#].*)?$/.exec(url)
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

    const slugMatch = /chapter-(\d+(?:-\d+)?)/i.exec(chapterId)
    if (!slugMatch?.[1]) {
      return 0
    }

    const parts = slugMatch[1].split('-')
    if (parts.length === 1) {
      return Number(parts[0])
    }

    return Number(`${parts[0]}.${parts.slice(1).join('')}`)
  }

  private parseChapterDate(block: string): Date {
    const dateText = /<span[^>]+class=["'][^"']*timediff[^"']*["'][^>]*>[\s\S]*?<i[^>]*>([\s\S]*?)<\/i>/i.exec(block)?.[1] ?? ''
    const parsed = new Date(this.cleanHtml(dateText))

    return Number.isNaN(parsed.getTime()) ? new Date() : parsed
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
