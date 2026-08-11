import { Chapter, ChapterDetails, MangaInfo, PagedResults, PartialSourceManga, Tag, TagSection } from '@paperback/types'
import { createReaderError } from '../utils/readerError'
import { normalizeHttpUrl } from '../utils/url'
import { AstralSearchParameters } from './models'

export class AstralMangaParser {
  constructor(private readonly baseUrl: string) {}

  parseMangaList(html: string, page: number): PagedResults {
    const matches = Array.from(this.searchable(html).matchAll(/href=["'](?:https?:\/\/[^/]+)?\/manga\/([0-9a-f-]{20,})["']/gi))
    const seen: Record<string, boolean> = {}
    const results: PartialSourceManga[] = []

    for (let index = 0; index < matches.length; index++) {
      const current = matches[index]
      const mangaId = current?.[1] ?? ''
      if (!mangaId || seen[mangaId]) continue
      const currentIndex = current?.index ?? 0
      const block = this.searchable(html).slice(currentIndex, matches[index + 1]?.index ?? currentIndex + 8000)
      const title = this.clean(this.value(block, ['title', 'name']) || /<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/i.exec(block)?.[1] || /alt=["']([^"']+)["']/i.exec(block)?.[1] || '')
      const image = this.firstImage(block)
      seen[mangaId] = true
      results.push(App.createPartialSourceManga({ mangaId, title: title || mangaId, image }))
    }

    return App.createPagedResults({
      results,
      metadata: this.hasNextPage(html, page) ? { page: page + 1 } : undefined
    })
  }

  parseMangaDetails(mangaId: string, html: string): MangaInfo {
    const text = this.searchable(html)
    const title = this.clean(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(text)?.[1] || this.value(text, ['title', 'name']) || mangaId)
    const cover = this.firstImage(text, true)
    const description = this.clean(this.value(text, ['description', 'synopsis']) || /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i.exec(text)?.[1] || '')
    const status = this.clean(this.value(text, ['status']) || (/\b(En cours|Termine|Terminé|En pause|Abandonne|Abandonné)\b/i.exec(this.clean(text))?.[1] ?? 'Unknown'))
    const genres = this.values(text, 'tags').concat(this.values(text, 'genres')).filter((value, index, all) => value && all.indexOf(value) === index)
    const author = this.clean(this.value(text, ['author', 'authors']) || 'Unknown')
    const artist = this.clean(this.value(text, ['artist', 'artists']) || 'Unknown')
    const year = this.value(text, ['year', 'publicationYear'])
    const type = this.value(text, ['type'])
    const additionalInfo: Record<string, string> = {}
    if (year) additionalInfo.Year = year
    if (type) additionalInfo.Type = type

    return App.createMangaInfo({
      image: cover,
      titles: [title],
      author,
      artist,
      desc: description,
      status,
      hentai: false,
      tags: genres.length ? [this.tagSection(genres)] : [],
      covers: cover ? [cover] : [],
      additionalInfo
    })
  }

  parseChapters(mangaId: string, html: string): Chapter[] {
    const text = this.searchable(html)
    const pattern = new RegExp(`href=["'](?:https?:\\/\\/[^/]+)?\\/manga\\/${this.escape(mangaId)}\\/chapter\\/([0-9a-f-]{20,})["']`, 'gi')
    const matches = Array.from(text.matchAll(pattern))
    const seen: Record<string, boolean> = {}
    const chapters: Chapter[] = []

    for (let index = 0; index < matches.length; index++) {
      const current = matches[index]
      const id = current?.[1] ?? ''
      if (!id || seen[id]) continue
      const currentIndex = current?.index ?? 0
      const block = text.slice(currentIndex, matches[index + 1]?.index ?? currentIndex + 1500)
      const name = this.clean(/Chapitre\s*\d+(?:\.\d+)?(?:\s*[-–][^<"}]*)?/i.exec(this.clean(block))?.[0] ?? this.value(block, ['title', 'name', 'number']))
      const chapNum = Number(/\d+(?:\.\d+)?/.exec(name)?.[0] ?? 0)
      seen[id] = true
      chapters.push(App.createChapter({ id, chapNum, name: name || `Chapitre ${chapNum}`, langCode: 'fr', group: 'Astral Manga', sortingIndex: chapNum }))
    }

    return chapters.sort((left, right) => left.chapNum - right.chapNum)
  }

  parseChapterDetails(mangaId: string, chapterId: string, html: string): ChapterDetails {
    const candidates = this.imageCandidates(this.searchable(html)).filter(url => !/logo|favicon|avatar|cover|banner|no_image|discord/i.test(url))
    const groups: Record<string, string[]> = {}
    for (const url of candidates) {
      const key = url.replace(/[?#].*$/, '').replace(/\/[^/]+$/, '/')
      if (!groups[key]) groups[key] = []
      if (!groups[key]?.includes(url)) groups[key]?.push(url)
    }
    const pages = Object.values(groups).sort((left, right) => right.length - left.length)[0] ?? []
    if (pages.length === 0) throw createReaderError('Astral Manga', mangaId, chapterId, html)
    return App.createChapterDetails({ id: chapterId, mangaId, pages })
  }

  parseSearchTags(html: string): TagSection[] {
    const text = this.searchable(html)
    const values = [...this.values(text, 'allTags'), ...this.values(text, 'tags')]
      .filter((value, index, all) => value && all.indexOf(value) === index)
      .sort((left, right) => left.localeCompare(right))
    return [this.tagSection(values)]
  }

  buildCatalogueUrl(page: number, title = '', tags: Tag[] = [], parameters: AstralSearchParameters = {}): string {
    const query: Array<[string, string]> = []
    if (title.trim()) query.push(['search', title.trim()])
    if (tags.length) query.push(['tags', tags.map(tag => tag.id).join(',')])
    if (parameters.status) query.push(['status', parameters.status])
    if (parameters.type) query.push(['types', parameters.type])
    if (parameters.sort) query.push(['sort', parameters.sort])
    if (page > 1) query.push(['page', String(page)])
    return this.url('/catalog', query)
  }

  buildSeriesUrl(mangaId: string): string { return `${this.baseUrl}/manga/${encodeURIComponent(mangaId)}` }
  buildChapterUrl(mangaId: string, chapterId: string): string { return `${this.buildSeriesUrl(mangaId)}/chapter/${encodeURIComponent(chapterId)}` }

  private firstImage(text: string, preferCover = false): string {
    const images = this.imageCandidates(text).filter(url => !/logo|favicon|avatar|discord|no_image/i.test(url))
    return (preferCover ? images.find(url => /cover|thumbnail|manga/i.test(url)) : images[0]) ?? images[0] ?? ''
  }

  private imageCandidates(text: string): string[] {
    const values: string[] = []
    const patterns = [/(?:src|data-src)=["']([^"']+)["']/gi, /["']((?:https?:\\?\/\\?\/|\/)[^"']+\.(?:jpg|jpeg|png|webp|avif)(?:\?[^"']*)?)["']/gi]
    for (const pattern of patterns) for (const match of text.matchAll(pattern)) {
      const url = normalizeHttpUrl(this.decode(match[1] ?? ''), this.baseUrl)
      if (url && !values.includes(url)) values.push(url)
    }
    return values
  }

  private value(text: string, fields: string[]): string {
    for (const field of fields) {
      const match = new RegExp(`["']${this.escape(field)}["']\\s*:\\s*(?:["']((?:\\\\.|[^"'])*)["']|(-?\\d+(?:\\.\\d+)?))`, 'i').exec(text)
      if (match?.[1] || match?.[2]) return this.clean(match[1] ?? match[2] ?? '')
    }
    return ''
  }

  private values(text: string, field: string): string[] {
    const raw = new RegExp(`["']${this.escape(field)}["']\\s*:\\s*\\[([^\\]]*)\\]`, 'i').exec(text)?.[1] ?? ''
    return Array.from(raw.matchAll(/["']([^"']+)["']/g), match => this.clean(match[1] ?? '')).filter(Boolean)
  }

  private tagSection(labels: string[]): TagSection {
    return App.createTagSection({ id: 'genres', label: 'Genres', tags: labels.map(label => App.createTag({ id: label, label })) })
  }

  private hasNextPage(html: string, page: number): boolean { return new RegExp(`[?&]page=${page + 1}\\b|"page":${page + 1}\\b`, 'i').test(html) }
  private url(path: string, query: Array<[string, string]>): string { const value = query.map(([key, item]) => `${encodeURIComponent(key)}=${encodeURIComponent(item)}`).join('&'); return `${this.baseUrl}${path}${value ? `?${value}` : ''}` }
  private searchable(value: string): string { return this.decode(value).replace(/\\"/g, '"') }
  private clean(value: string): string { return this.decode(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }
  private decode(value: string): string { return value.replace(/\\\//g, '/').replace(/\\u([0-9a-f]{4})/gi, (_match, code: string) => String.fromCharCode(parseInt(code, 16))).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#(?:39|8217);/g, "'").replace(/&nbsp;/g, ' ') }
  private escape(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
}
