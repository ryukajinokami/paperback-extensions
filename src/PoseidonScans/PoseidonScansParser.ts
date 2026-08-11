import { Chapter, ChapterDetails, MangaInfo, PagedResults, PartialSourceManga, Tag, TagSection } from '@paperback/types'
import { PoseidonJsonLd, PoseidonSearchFilters, PoseidonSearchParameters } from './models'
import { createReaderError } from '../utils/readerError'
import { normalizeHttpUrl } from '../utils/url'
import { parseDateOrUndefined } from '../utils/date'

const CATALOGUE_PAGE_SIZE = 20

export class PoseidonScansParser {
  constructor(private readonly baseUrl: string, private readonly sourceName = 'Poseidon Scans') {}

  parseMangaList(html: string, page: number): PagedResults {
    const text = this.searchableHtml(html)
    const results = this.parseMangaCards(text)

    return App.createPagedResults({
      results,
      metadata: this.hasNextPage(text, page) ? { page: page + 1 } : undefined
    })
  }

  parseSearchTags(html: string): TagSection[] {
    const text = this.searchableHtml(html)
    const genres = this.parseSerializedArray(text, 'allTags')
    const types = this.parseSerializedArray(text, 'allTypes')

    return [
      App.createTagSection({
        id: 'genres',
        label: 'Genres',
        tags: genres.map(label => App.createTag({ id: `genre:${label}`, label }))
      }),
      App.createTagSection({
        id: 'types',
        label: 'Types',
        tags: types.map(label => App.createTag({ id: `type:${label}`, label }))
      }),
      App.createTagSection({
        id: 'status',
        label: 'Statut',
        tags: [
          App.createTag({ id: 'status:en cours', label: 'En cours' }),
          App.createTag({ id: 'status:terminé', label: 'Terminé' }),
          App.createTag({ id: 'status:en pause', label: 'En pause' }),
          App.createTag({ id: 'status:annulé', label: 'Annulé' })
        ]
      })
    ]
  }

  splitSearchTags(tags: Tag[]): PoseidonSearchFilters {
    const filters: PoseidonSearchFilters = { tags: [] }

    for (const tag of tags) {
      if (tag.id.startsWith('status:')) {
        filters.status = tag.id.slice('status:'.length)
      } else if (tag.id.startsWith('genre:') || tag.id.startsWith('type:')) {
        filters.tags.push(tag.id.slice(tag.id.indexOf(':') + 1))
      }
    }

    return filters
  }

  parseMangaDetails(mangaId: string, html: string): MangaInfo {
    const series = this.findJsonLd(html, 'ComicSeries')
    const title = this.cleanText(series?.name ?? '') || this.titleFromSlug(mangaId)
    const cover = this.normalizeUrl(this.imageValue(series?.image) || this.extractMetaContent(html, 'og:image') || `/api/covers/${mangaId}.webp`)
    const genres = this.stringArray(series?.genre)

    const alternativeTitles = this.splitTitles(this.extractSerializedString(html, 'alternativeNames'))

    return App.createMangaInfo({
      image: cover,
      titles: Array.from(new Set([title, ...alternativeTitles])),
      author: this.personName(series?.author),
      artist: this.personName(series?.artist),
      desc: this.cleanText(series?.description ?? this.extractMetaContent(html, 'description')),
      status: this.extractStatus(html) || 'Unknown',
      hentai: false,
      rating: this.extractRating(html),
      tags: genres.length > 0 ? [this.toTagSection(genres)] : [],
      covers: cover.length > 0 ? [cover] : [],
      banner: this.normalizeUrl(`/api/banners-mangas/${mangaId}.webp`),
      additionalInfo: this.seriesAdditionalInfo(html)
    })
  }

  parseChapters(mangaId: string, html: string): Chapter[] {
    const text = this.searchableHtml(html)
    const serializedChapters = this.parseSerializedChapters(text)

    if (serializedChapters.length > 0) {
      return serializedChapters
    }

    const escapedMangaId = this.escapeRegExp(mangaId)
    const chapterPattern = new RegExp(`href(?:=|":)"\\/serie\\/${escapedMangaId}\\/chapter\\/([^/"?#]+)"`, 'gi')
    const matches: Array<{ id: string, index: number }> = []
    let match: RegExpExecArray | null

    while ((match = chapterPattern.exec(text)) !== null) {
      if (match[1]) {
        matches.push({ id: this.decodeText(match[1]), index: match.index })
      }
    }

    const seen: Record<string, boolean> = {}
    const chapters: Chapter[] = []

    for (let index = 0; index < matches.length; index++) {
      const current = matches[index]
      if (!current || seen[current.id]) {
        continue
      }

      const next = matches[index + 1]
      const block = text.slice(current.index, next?.index ?? current.index + 5000)

      if (this.isRestrictedChapter(block)) {
        continue
      }

      seen[current.id] = true
      const chapNum = this.chapterNumber(current.id, block)

      chapters.push(App.createChapter({
        id: current.id,
        chapNum,
        name: this.extractChapterName(current.id, block),
        langCode: 'fr',
        group: this.sourceName,
        sortingIndex: chapNum
      }))
    }

    return chapters.sort((left, right) => left.chapNum - right.chapNum)
  }

  parseChapterDetails(mangaId: string, chapterId: string, html: string): ChapterDetails {
    const pages = this.extractReaderImages(mangaId, html)

    if (pages.length === 0) {
      throw createReaderError(this.sourceName, mangaId, chapterId, html)
    }

    return App.createChapterDetails({
      id: chapterId,
      mangaId,
      pages
    })
  }

  buildCatalogueUrl(page: number, sortBy?: string): string {
    const parameters: Array<[string, string]> = []
    if (sortBy) parameters.push(['sortBy', sortBy])
    if (page > 1) parameters.push(['page', String(page)])

    return this.buildUrl('/series', parameters)
  }

  buildSearchUrl(title: string, page: number, filters: PoseidonSearchFilters, parameters: PoseidonSearchParameters): string {
    const query: Array<[string, string]> = []

    if (title.trim().length > 0) {
      query.push(['search', title.trim()])
    }

    if (filters.tags.length > 0) query.push(['tags', filters.tags.join(',')])
    if (filters.status) query.push(['status', filters.status])
    if (parameters.sortBy) query.push(['sortBy', parameters.sortBy])
    if (parameters.minChapters) query.push(['minChapters', parameters.minChapters])
    if (parameters.maxChapters) query.push(['maxChapters', parameters.maxChapters])

    if (page > 1) {
      query.push(['page', String(page)])
    }

    return this.buildUrl('/series', query)
  }

  buildSeriesUrl(mangaId: string): string {
    return `${this.baseUrl}/serie/${encodeURIComponent(mangaId)}`
  }

  buildChapterUrl(mangaId: string, chapterId: string): string {
    return `${this.buildSeriesUrl(mangaId)}/chapter/${encodeURIComponent(chapterId)}`
  }

  normalizeUrl(value: string): string {
    const cleaned = this.decodeText(value.trim()).split(',')[0]?.trim().replace(/\s+\d+[wx]$/, '') ?? ''
    return normalizeHttpUrl(cleaned, this.baseUrl)
  }

  private parseMangaCards(text: string): PartialSourceManga[] {
    const cardPattern = /href(?:=|":)"\/serie\/([^/"?#]+)"/gi
    const matches: Array<{ mangaId: string, index: number }> = []
    let match: RegExpExecArray | null

    while ((match = cardPattern.exec(text)) !== null) {
      if (match[1]) {
        matches.push({ mangaId: this.decodeText(match[1]), index: match.index })
      }
    }

    const seen: Record<string, boolean> = {}
    const results: PartialSourceManga[] = []

    for (let index = 0; index < matches.length; index++) {
      const current = matches[index]
      if (!current || seen[current.mangaId]) {
        continue
      }

      const next = matches[index + 1]
      const block = text.slice(current.index, next?.index ?? current.index + 8000)
      const image = this.extractCardImage(block, current.mangaId)
      const title = this.extractCardTitle(block) || this.titleFromSlug(current.mangaId)

      seen[current.mangaId] = true
      results.push(App.createPartialSourceManga({
        mangaId: current.mangaId,
        title,
        image,
        subtitle: this.extractCardSubtitle(block)
      }))
    }

    return results
  }

  private parseSerializedArray(text: string, field: string): string[] {
    const escaped = this.escapeRegExp(field)
    const value = new RegExp(`"${escaped}":(\\[[^\\]]*\\])`).exec(text)?.[1]

    if (!value) return []

    try {
      const parsed = JSON.parse(value) as unknown
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
    } catch {
      return []
    }
  }

  private extractCardImage(block: string, mangaId: string): string {
    const imagePattern = /(?:src|srcSet)(?:=|":)"([^"]*(?:\/api\/covers\/|%2Fapi%2Fcovers%2F)[^"]*)"/gi
    let match: RegExpExecArray | null

    while ((match = imagePattern.exec(block)) !== null) {
      const image = this.normalizeUrl(match[1] ?? '')
      if (image.length > 0) {
        return image
      }
    }

    return this.normalizeUrl(`/api/covers/${mangaId}.webp`)
  }

  private extractCardTitle(block: string): string {
    const altPattern = /alt(?:=|":)"([^"]*)"/gi
    let match: RegExpExecArray | null

    while ((match = altPattern.exec(block)) !== null) {
      const title = this.cleanText(match[1] ?? '')
      if (title.length > 0 && title !== 'OR') {
        return title
      }
    }

    const h2 = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(block)?.[1] ?? ''
    return this.cleanHtml(h2)
  }

  private extractCardSubtitle(block: string): string | undefined {
    const count = /(\d+)(?:"?,\s*")?\s+chapitres/i.exec(this.cleanHtml(block))?.[1]

    return count ? `${count} chapitres` : undefined
  }

  private parseSerializedChapters(text: string): Chapter[] {
    const chapterPattern = /{"id":"[^"]+","number":(\d+(?:\.\d+)?),"title":(null|"((?:\\.|[^"])*)"),"createdAt":"\$D([^"]+)","isPremium":(true|false),"premiumUntil":(?:null|"\$D[^"]+")[\s\S]*?}/g
    const chapters: Chapter[] = []
    const seen: Record<string, boolean> = {}
    let match: RegExpExecArray | null

    while ((match = chapterPattern.exec(text)) !== null) {
      const number = match[1]
      const createdAt = match[4]
      const isPremium = match[5] === 'true'

      if (!number || seen[number] || isPremium) {
        continue
      }

      seen[number] = true
      const chapNum = Number(number)
      const title = this.cleanText(match[3] ?? '')
      const time = this.parseDate(createdAt)

      chapters.push(App.createChapter({
        id: number,
        chapNum,
        name: title.length > 0 ? `Chapitre ${number} - ${title}` : `Chapitre ${number}`,
        langCode: 'fr',
        group: this.sourceName,
        ...(time ? { time } : {}),
        sortingIndex: chapNum
      }))
    }

    return chapters.sort((left, right) => left.chapNum - right.chapNum)
  }

  private extractChapterName(chapterId: string, block: string): string {
    const h3 = /<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(block)?.[1]
    const name = this.cleanHtml(h3 ?? '')

    return name.length > 0 ? name : `Chapitre ${chapterId}`
  }

  private extractReaderImages(mangaId: string, html: string): string[] {
    const text = this.searchableHtml(html)
    const imagePattern = /src(?:=|":)"([^"]*\/api\/chapters\/[^"]+)"/gi
    const seen: Record<string, boolean> = {}
    const pages: string[] = []
    let match: RegExpExecArray | null

    while ((match = imagePattern.exec(text)) !== null) {
      const url = this.normalizeUrl(match[1] ?? '')

      if (!this.isReaderPageImage(url, mangaId) || seen[url]) {
        continue
      }

      seen[url] = true
      pages.push(url)
    }

    return pages
  }

  private isReaderPageImage(url: string, mangaId: string): boolean {
    const lower = url.toLowerCase()
    const normalizedMangaId = mangaId.toLowerCase()

    return lower.includes(`/api/chapters/${normalizedMangaId}/`) && !lower.includes('/previews/')
  }

  private isRestrictedChapter(block: string): boolean {
    const normalized = this.normalizeForComparison(this.cleanHtml(block))

    return normalized.includes('gratuit le') || normalized.includes('acces restreint') || normalized.includes('jouer l avance') || normalized.includes('abonner')
  }

  private chapterNumber(chapterId: string, block: string): number {
    const idMatch = /(\d+(?:[.-]\d+)?)/.exec(chapterId)
    if (idMatch?.[1]) {
      return Number(idMatch[1].replace('-', '.'))
    }

    const blockMatch = /chapitre\s+(\d+(?:[.-]\d+)?)/i.exec(this.cleanHtml(block))
    return blockMatch?.[1] ? Number(blockMatch[1].replace('-', '.')) : 0
  }

  private findJsonLd(html: string, type: string): PoseidonJsonLd | undefined {
    const blocks = this.jsonLdBlocks(html)

    return blocks.find(block => this.jsonLdHasType(block, type))
  }

  private jsonLdBlocks(html: string): PoseidonJsonLd[] {
    const blocks: PoseidonJsonLd[] = []
    const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    let match: RegExpExecArray | null

    while ((match = pattern.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(this.decodeText(match[1] ?? '')) as PoseidonJsonLd | PoseidonJsonLd[]
        blocks.push(...(Array.isArray(parsed) ? parsed : [parsed]))
      } catch {
        continue
      }
    }

    return blocks
  }

  private jsonLdHasType(block: PoseidonJsonLd, type: string): boolean {
    const value = block['@type']

    return Array.isArray(value) ? value.includes(type) : value === type
  }

  private imageValue(value: string | { url?: string } | undefined): string {
    if (typeof value === 'string') {
      return value
    }

    return value?.url ?? ''
  }

  private personName(value: string | { name?: string } | undefined): string {
    const name = typeof value === 'string' ? value : value?.name
    const cleaned = this.cleanText(name ?? '')

    return cleaned.length > 0 && this.normalizeForComparison(cleaned) !== 'non specifie' ? cleaned : 'Unknown'
  }

  private stringArray(value: string | string[] | undefined): string[] {
    const values = Array.isArray(value) ? value : value ? [value] : []

    return values.map(item => this.cleanText(item)).filter(item => item.length > 0)
  }

  private extractMetaContent(html: string, name: string): string {
    const escaped = this.escapeRegExp(name)
    const propertyPattern = new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i')
    const namePattern = new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i')

    return this.cleanText(propertyPattern.exec(html)?.[1] ?? namePattern.exec(html)?.[1] ?? '')
  }

  private extractStatus(html: string): string {
    const description = this.extractMetaContent(html, 'description')
    const status = /Statut\s*:\s*([^.]+)/i.exec(description)?.[1]

    if (status) {
      return this.cleanText(status)
    }

    const text = this.searchableHtml(html)
    const visible = /Statut[\s\S]{0,500}?<span[^>]*>([\s\S]*?)<\/span>/i.exec(text)?.[1]
    return this.cleanHtml(visible ?? '')
  }

  private extractRating(html: string): number | undefined {
    const text = this.searchableHtml(html)
    const visible = /<span[^>]*>\s*(\d+(?:\.\d+)?)\s*<\/span>\s*<span[^>]*>\s*\/5\s*<\/span>/i.exec(text)?.[1]
    const rating = Number(visible)

    return Number.isFinite(rating) ? rating : undefined
  }

  private seriesAdditionalInfo(html: string): Record<string, string> {
    const info: Record<string, string> = {}
    const type = this.extractSerializedStrings(html, 'type')
      .find(value => /^(?:MANGA|MANHWA|MANHUA|COMIC)$/i.test(value))
    const releaseYear = this.extractSerializedNumber(html, 'releaseYear')
    const views = this.extractSerializedNumber(html, 'viewCount')
    const favorites = /"favorites":(\d+)/.exec(this.searchableHtml(html))?.[1]

    if (type) info.Type = type
    if (releaseYear) info.Year = releaseYear
    if (views) info.Views = views
    if (favorites) info.Favorites = favorites

    return info
  }

  private extractSerializedString(html: string, field: string): string {
    return this.extractSerializedStrings(html, field)[0] ?? ''
  }

  private extractSerializedStrings(html: string, field: string): string[] {
    const escaped = this.escapeRegExp(field)
    const pattern = new RegExp(`"${escaped}":(?:null|"((?:\\\\.|[^"])*)")`, 'g')
    const text = this.searchableHtml(html)
    const values: string[] = []
    let match: RegExpExecArray | null

    while ((match = pattern.exec(text)) !== null) {
      const value = this.cleanText(match[1] ?? '')
      if (value) values.push(value)
    }

    return values
  }

  private extractSerializedNumber(html: string, field: string): string {
    const escaped = this.escapeRegExp(field)
    return new RegExp(`"${escaped}":(null|-?\\d+(?:\\.\\d+)?)`).exec(this.searchableHtml(html))?.[1]?.replace('null', '') ?? ''
  }

  private splitTitles(value: string): string[] {
    return value
      .split(/[|;,]/)
      .map(title => this.cleanText(title))
      .filter(title => title.length > 0)
  }

  private parseDate(value: string | undefined): Date | undefined {
    return parseDateOrUndefined(value)
  }

  private toTagSection(labels: string[]): TagSection {
    return App.createTagSection({
      id: 'genres',
      label: 'Genres',
      tags: labels.map(label => App.createTag({
        id: this.tagId(label),
        label
      }))
    })
  }

  private tagId(label: string): string {
    return this.normalizeForComparison(label)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  private hasNextPage(text: string, page: number): boolean {
    const nextPagePattern = new RegExp(`[?&]page=${page + 1}\\b`, 'i')

    return nextPagePattern.test(text)
  }

  private buildUrl(path: string, parameters: Array<[string, string]>): string {
    const query = parameters
      .filter(([, value]) => value.trim().length > 0)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&')

    return `${this.baseUrl}${path}${query.length > 0 ? `?${query}` : ''}`
  }

  private searchableHtml(html: string): string {
    return this.decodeText(html)
      .replace(/\\"/g, '"')
      .replace(/<!--\s*-->/g, '')
  }

  private cleanHtml(value: string): string {
    return this.cleanText(value
      .replace(/<!--\s*-->/g, '')
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
      .replace(/\\u([0-9a-fA-F]{4})/g, (_match: string, code: string) => String.fromCharCode(parseInt(code, 16)))
      .replace(/\\n/g, '\n')
      .replace(/\\\//g, '/')
      .replace(/\\"/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#x([0-9a-f]+);/gi, (_match: string, code: string) => String.fromCharCode(parseInt(code, 16)))
      .replace(/&#(\d+);/g, (_match: string, code: string) => String.fromCharCode(parseInt(code, 10)))
      .replace(/&rsquo;/g, "'")
      .replace(/&lsquo;/g, "'")
      .replace(/&ldquo;/g, '"')
      .replace(/&rdquo;/g, '"')
      .replace(/&hellip;/g, '...')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
  }

  private normalizeForComparison(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  }

  private titleFromSlug(slug: string): string {
    return slug
      .split('-')
      .filter(part => part.length > 0)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}
