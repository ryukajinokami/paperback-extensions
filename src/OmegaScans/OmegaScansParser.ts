import { Chapter, ChapterDetails, MangaInfo, PagedResults, PartialSourceManga, Tag, TagSection } from '@paperback/types'
import { OmegaChapter, OmegaListResponse, OmegaSeries, OmegaTag } from './models'

export class OmegaScansParser {
  constructor(
    private readonly baseUrl: string,
    private readonly apiUrl: string
  ) {}

  parsePagedSeries(response: OmegaListResponse<OmegaSeries>): PagedResults {
    return App.createPagedResults({
      results: response.data.map(series => this.toPartialSourceManga(series)),
      metadata: response.meta?.next_page_url ? { page: (response.meta.current_page ?? 1) + 1 } : undefined
    })
  }

  parseMangaDetails(series: OmegaSeries): MangaInfo {
    const titleSet = [series.title, ...(series.alternative_names ?? '').split('|')]
      .map(title => this.cleanText(title))
      .filter(title => title.length > 0)

    return App.createMangaInfo({
      image: this.normalizeUrl(series.thumbnail ?? ''),
      titles: Array.from(new Set(titleSet.length > 0 ? titleSet : [series.series_slug])),
      author: this.cleanText(series.author ?? 'Unknown'),
      artist: this.cleanText(series.studio ?? series.author ?? 'Unknown'),
      desc: this.cleanHtml(series.description ?? ''),
      status: this.cleanText(series.status ?? 'Unknown'),
      hentai: true,
      rating: typeof series.rating === 'number' ? series.rating : undefined,
      tags: [this.toTagSection(series.tags ?? [])],
      covers: [this.normalizeUrl(series.thumbnail ?? '')].filter(url => url.length > 0)
    })
  }

  parseChapters(response: OmegaListResponse<OmegaChapter>): Chapter[] {
    return response.data
      .filter(chapter => (chapter.price ?? 0) <= 0)
      .map(chapter => App.createChapter({
        id: chapter.chapter_slug,
        chapNum: this.chapterNumber(chapter),
        name: this.chapterName(chapter),
        langCode: 'en',
        group: 'Omega Scans',
        time: this.parseDate(chapter.created_at),
        sortingIndex: this.chapterNumber(chapter)
      }))
      .sort((left, right) => left.chapNum - right.chapNum)
  }

  parseChapterDetails(mangaId: string, chapterId: string, html: string): ChapterDetails {
    const pages = this.extractReaderImages(mangaId, html)
    const resolvedPages = pages.length > 0 ? pages : this.extractNovelPages(html)

    if (resolvedPages.length === 0) {
      throw new Error(`No readable pages found for ${mangaId}/${chapterId}`)
    }

    return App.createChapterDetails({
      id: chapterId,
      mangaId,
      pages: resolvedPages
    })
  }

  toPartialSourceManga(series: OmegaSeries): PartialSourceManga {
    return App.createPartialSourceManga({
      mangaId: series.series_slug,
      title: this.cleanText(series.title),
      image: this.normalizeUrl(series.thumbnail ?? ''),
      subtitle: this.subtitle(series)
    })
  }

  parseSearchTags(tags: OmegaTag[]): TagSection[] {
    return [
      App.createTagSection({
        id: 'genres',
        label: 'Genres',
        tags: tags
          .sort((left, right) => left.name.localeCompare(right.name))
          .map(tag => this.toSearchTag(tag))
      }),
      App.createTagSection({
        id: 'type',
        label: 'Type',
        tags: [
          App.createTag({ id: 'type:Comic', label: 'Comic' }),
          App.createTag({ id: 'type:Novel', label: 'Novel' })
        ]
      }),
      App.createTagSection({
        id: 'status',
        label: 'Status',
        tags: [
          App.createTag({ id: 'status:Ongoing', label: 'Ongoing' }),
          App.createTag({ id: 'status:Completed', label: 'Completed' }),
          App.createTag({ id: 'status:Hiatus', label: 'Hiatus' }),
          App.createTag({ id: 'status:Dropped', label: 'Dropped' })
        ]
      })
    ]
  }

  splitSearchTags(tags: Tag[]): { genreIds: string[], type?: string, status?: string } {
    const genreIds: string[] = []
    let type: string | undefined
    let status: string | undefined

    for (const tag of tags) {
      if (tag.id.startsWith('type:')) {
        type = tag.id.replace('type:', '')
      } else if (tag.id.startsWith('status:')) {
        status = tag.id.replace('status:', '')
      } else {
        genreIds.push(tag.id)
      }
    }

    return { genreIds, type, status }
  }

  seriesHasAnyTag(series: OmegaSeries, tagIds: string[]): boolean {
    if (tagIds.length === 0) {
      return false
    }

    const seriesTagIds = (series.tags ?? []).map(tag => String(tag.id))
    return tagIds.some(tagId => seriesTagIds.includes(tagId))
  }

  normalizeUrl(value: string): string {
    const cleaned = this.decodeText(value.trim())

    if (cleaned.length === 0) {
      return ''
    }

    const proxiedImage = /[?&]url=([^&]+)/.exec(cleaned)
    if (cleaned.startsWith('/_next/image') && proxiedImage?.[1]) {
      return decodeURIComponent(proxiedImage[1])
    }

    if (cleaned.startsWith('//')) {
      return `https:${cleaned}`
    }

    if (cleaned.startsWith('/')) {
      return `${this.baseUrl}${cleaned}`
    }

    return cleaned
  }

  buildSeriesUrl(mangaId: string): string {
    return `${this.baseUrl}/series/${encodeURIComponent(mangaId)}`
  }

  buildChapterUrl(mangaId: string, chapterId: string): string {
    return `${this.buildSeriesUrl(mangaId)}/${encodeURIComponent(chapterId)}`
  }

  buildApiUrl(path: string, params: Record<string, string | number | boolean | undefined> = {}): string {
    const query = Object.entries(params)
      .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&')

    return `${this.apiUrl}${path}${query.length > 0 ? `?${query}` : ''}`
  }

  private extractReaderImages(mangaId: string, html: string): string[] {
    const decoded = this.decodeText(html)
    const renderedImages = this.extractRenderedReaderImages(decoded)

    if (renderedImages.length > 0) {
      return renderedImages
    }

    const escapedSlug = this.escapeRegExp(mangaId)
    const imagePattern = new RegExp(
      `https?://media\\.omegascans\\.org/file/[^"'<>,\\s]+/uploads/series/${escapedSlug}/[^"'<>,\\s]+?\\.(?:jpg|jpeg|png|webp|gif)`,
      'gi'
    )

    const seen: Record<string, boolean> = {}
    const pages: string[] = []
    const matches = decoded.match(imagePattern) ?? []

    for (const match of matches) {
      const url = this.normalizeUrl(match.replace(/\\\//g, '/'))
      if (!seen[url]) {
        seen[url] = true
        pages.push(url)
      }
    }

    return pages
  }

  private extractRenderedReaderImages(html: string): string[] {
    const imageTags = html.match(/<img[^>]+>/gi) ?? []
    const seen: Record<string, boolean> = {}
    const pages: string[] = []

    for (const tag of imageTags) {
      if (!/\bobject-contain\b/i.test(tag)) {
        continue
      }

      const source = /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1] ?? ''
      const url = this.normalizeUrl(source)

      if (!this.isOmegaMediaImage(url) || seen[url]) {
        continue
      }

      seen[url] = true
      pages.push(url)
    }

    return pages
  }

  private isOmegaMediaImage(url: string): boolean {
    return /^https?:\/\/media\.omegascans\.org\/file\/[^"'<>,\s]+?\.(?:jpg|jpeg|png|webp|gif)(?:[?#].*)?$/i.test(url)
  }

  private extractNovelPages(html: string): string[] {
    const content = this.extractNovelContent(html)
    const paragraphMatches = content.match(/<p[\s\S]*?<\/p>/gi) ?? []
    const paragraphs = paragraphMatches
      .map(paragraph => this.cleanHtml(paragraph))
      .map(paragraph => paragraph.replace(/\s+/g, ' ').trim())
      .filter(paragraph => paragraph.length > 0)

    if (paragraphs.length === 0) {
      return []
    }

    const pages: string[] = []
    const lines = this.wrapText(paragraphs.join('\n\n'), 46)
    const linesPerPage = 34

    for (let index = 0; index < lines.length; index += linesPerPage) {
      pages.push(this.svgPage(lines.slice(index, index + linesPerPage)))
    }

    return pages
  }

  private extractNovelContent(html: string): string {
    const payloads: string[] = []
    const payloadPattern = /self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)<\/script>/g
    let payloadMatch: RegExpExecArray | null

    while ((payloadMatch = payloadPattern.exec(html)) !== null) {
      if (payloadMatch[1]) {
        payloads.push(this.decodeText(payloadMatch[1]).replace(/\\"/g, '"'))
      }
    }

    const flightPayload = payloads.join('')
    const contentReference = /chapter_content":"\$([^"]+)"/.exec(flightPayload)
    if (!contentReference?.[1]) {
      return ''
    }

    const contentId = this.escapeRegExp(contentReference[1])
    const contentMarker = new RegExp(`${contentId}:T([0-9a-f]+),`).exec(flightPayload)
    if (!contentMarker?.[1]) {
      return ''
    }

    const start = (contentMarker.index ?? 0) + contentMarker[0].length
    const length = parseInt(contentMarker[1], 16)

    return flightPayload.slice(start, start + length)
  }

  private wrapText(text: string, maxLineLength: number): string[] {
    const lines: string[] = []
    const paragraphs = text.split(/\n{2,}/)

    for (const paragraph of paragraphs) {
      const words = paragraph.split(/\s+/).filter(word => word.length > 0)
      let currentLine = ''

      for (const word of words) {
        const nextLine = currentLine.length > 0 ? `${currentLine} ${word}` : word
        if (nextLine.length > maxLineLength && currentLine.length > 0) {
          lines.push(currentLine)
          currentLine = word
        } else {
          currentLine = nextLine
        }
      }

      if (currentLine.length > 0) {
        lines.push(currentLine)
      }
      lines.push('')
    }

    return lines
  }

  private svgPage(lines: string[]): string {
    const escapedLines = lines.map(line => this.escapeXml(line))
    const text = escapedLines
      .map((line, index) => `<text x="60" y="${80 + index * 38}">${line}</text>`)
      .join('')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1400" viewBox="0 0 900 1400"><rect width="900" height="1400" fill="#111111"/><g fill="#f4f4f5" font-family="Arial, Helvetica, sans-serif" font-size="27">${text}</g></svg>`

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }

  private toTagSection(tags: OmegaTag[]): TagSection {
    return App.createTagSection({
      id: 'genres',
      label: 'Genres',
      tags: tags.map(tag => this.toSearchTag(tag))
    })
  }

  private toSearchTag(tag: OmegaTag): Tag {
    return App.createTag({
      id: String(tag.id),
      label: this.cleanText(tag.name)
    })
  }

  private subtitle(series: OmegaSeries): string | undefined {
    const parts = [
      series.status,
      series.series_type,
      series.meta?.chapters_count ? `${series.meta.chapters_count} chapters` : undefined
    ].filter((part): part is string => typeof part === 'string' && part.length > 0)

    return parts.length > 0 ? parts.join(' | ') : undefined
  }

  private chapterName(chapter: OmegaChapter): string {
    const title = this.cleanText(chapter.chapter_title ?? '')
    const name = this.cleanText(chapter.chapter_name)

    return title.length > 0 ? `${name} - ${title}` : name
  }

  private chapterNumber(chapter: OmegaChapter): number {
    const indexed = Number(chapter.index)
    if (!Number.isNaN(indexed)) {
      return indexed
    }

    const normalizedSlug = chapter.chapter_slug.replace(/-/g, '.')
    const slugMatch = /(\d+(?:\.\d+)?)/.exec(normalizedSlug)
    if (slugMatch?.[1]) {
      return Number(slugMatch[1])
    }

    const nameMatch = /(\d+(?:\.\d+)?)/.exec(chapter.chapter_name)
    return nameMatch?.[1] ? Number(nameMatch[1]) : 0
  }

  private parseDate(value?: string): Date {
    if (!value) {
      return new Date()
    }

    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed
  }

  private cleanHtml(value: string): string {
    return this.cleanText(value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ''))
  }

  private cleanText(value: string): string {
    return this.decodeText(value).replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
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
      .replace(/\\\//g, '/')
      .replace(/\\"/g, '"')
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
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}
