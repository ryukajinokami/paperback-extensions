import { Chapter, ChapterDetails, MangaInfo, PagedResults, PartialSourceManga, Tag, TagSection } from '@paperback/types'
import { createReaderError } from '../utils/readerError'
import { normalizeHttpUrl } from '../utils/url'
import { parseDateOrUndefined } from '../utils/date'
import { LelMangaSearchParameters } from './models'

export class LelMangaParser {
  constructor(private readonly baseUrl: string) {}

  parseMangaList(html: string, page: number): PagedResults {
    const results: PartialSourceManga[] = []
    const seen: Record<string, boolean> = {}
    const matches: Array<{ type: string, slug: string, title: string, index: number }> = []
    const pattern = /<a[^>]+href=["'](?:https?:\/\/[^/]+)?\/(manga|manhwa|manhua|comic)\/([^/"'?#]+)\/?[^"']*["'][^>]*title=["']([^"']+)["'][^>]*>/gi
    let match: RegExpExecArray | null

    while ((match = pattern.exec(html)) !== null) {
      matches.push({ type: match[1] ?? '', slug: match[2] ?? '', title: match[3] ?? '', index: match.index })
    }

    for (let index = 0; index < matches.length; index++) {
      const current = matches[index]
      if (!current) continue
      const mangaId = `${current.type}/${this.decodeText(current.slug)}`
      if (seen[mangaId]) continue

      const block = html.slice(current.index, matches[index + 1]?.index ?? current.index + 5000)
      const imageValue = /<img[^>]+(?:data-src|src)=["']([^"']+)["']/i.exec(block)?.[1] ?? ''
      const subtitle = this.cleanHtml(/<div[^>]+class=["'][^"']*epxs[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(block)?.[1] ?? '')

      seen[mangaId] = true
      results.push(App.createPartialSourceManga({
        mangaId,
        title: this.cleanText(current.title),
        image: this.normalizeUrl(imageValue),
        subtitle: subtitle || undefined
      }))
    }

    return App.createPagedResults({
      results,
      metadata: this.hasNextPage(html, page) ? { page: page + 1 } : undefined
    })
  }

  parseSearchTags(html: string): TagSection[] {
    const tags: Tag[] = []
    const seen: Record<string, boolean> = {}
    const pattern = /<input[^>]+name=["']genre\[\]["'][^>]+value=["'](\d+)["'][^>]*>[\s\S]*?<label[^>]*>([\s\S]*?)<\/label>/gi
    let match: RegExpExecArray | null

    while ((match = pattern.exec(html)) !== null) {
      const id = match[1] ?? ''
      const label = this.cleanHtml(match[2] ?? '')
      if (!id || !label || seen[id]) continue
      seen[id] = true
      tags.push(App.createTag({ id, label }))
    }

    return [App.createTagSection({ id: 'genres', label: 'Genres', tags })]
  }

  parseMangaDetails(mangaId: string, html: string): MangaInfo {
    const title = this.cleanHtml(/<h1[^>]+class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '') || this.titleFromId(mangaId)
    const coverValue = /<div[^>]+class=["'][^"']*thumb[^"']*["'][^>]*>[\s\S]*?<img[^>]+(?:data-src|src)=["']([^"']+)["']/i.exec(html)?.[1]
      ?? this.metaContent(html, 'og:image')
    const cover = this.normalizeUrl(coverValue)
    const description = this.cleanHtml(/<div[^>]+class=["'][^"']*entry-content-single[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1] ?? '')
    const status = this.infoValue(html, 'Statut') || 'Unknown'
    const type = this.infoValue(html, 'Type')
    const genres = this.parseGenres(html)
    const rating = Number(/itemprop=["']ratingValue["'][^>]+content=["'](\d+(?:\.\d+)?)["']/i.exec(html)?.[1])
    const followers = /class=["'][^"']*bmc[^"']*["'][^>]*>[\s\S]*?(\d[\d\s.,]*)\s+(?:people|personnes)/i.exec(html)?.[1]
    const alternative = this.cleanHtml(/<div[^>]+class=["'][^"']*alter[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1] ?? '')
    const titles = [title, ...alternative.split(/[;,|]/).map(value => value.trim()).filter(Boolean)]
    const additionalInfo: Record<string, string> = {}
    if (type) additionalInfo.Type = type
    if (followers) additionalInfo.Followers = followers.trim()

    return App.createMangaInfo({
      image: cover,
      titles: Array.from(new Set(titles)),
      desc: description,
      status,
      hentai: false,
      rating: Number.isFinite(rating) ? rating : undefined,
      tags: genres.length > 0 ? [App.createTagSection({
        id: 'genres',
        label: 'Genres',
        tags: genres.map(genre => App.createTag({ id: this.tagId(genre), label: genre }))
      })] : [],
      covers: cover ? [cover] : [],
      additionalInfo
    })
  }

  parseChapters(mangaId: string, html: string): Chapter[] {
    const list = /<div[^>]+class=["'][^"']*eplister[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i.exec(html)?.[1] ?? ''
    const chapters: Chapter[] = []
    const pattern = /<li[^>]+data-num=["']([^"']+)["'][^>]*>[\s\S]*?<a[^>]+href=["'](?:https?:\/\/[^/]+)?\/([^/"'?#]+)\/?["'][^>]*>[\s\S]*?<span[^>]+class=["'][^"']*chapternum[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<span[^>]+class=["'][^"']*chapterdate[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi
    let match: RegExpExecArray | null

    while ((match = pattern.exec(list)) !== null) {
      const chapNum = this.chapterNumber(match[1] ?? '')
      const time = this.parseDate(this.cleanHtml(match[4] ?? ''))
      chapters.push(App.createChapter({
        id: this.decodeText(match[2] ?? ''),
        chapNum,
        name: this.cleanHtml(match[3] ?? '') || `Chapitre ${match[1]}`,
        langCode: 'fr',
        group: 'LelManga',
        ...(time ? { time } : {}),
        sortingIndex: chapNum
      }))
    }

    return chapters.sort((left, right) => left.chapNum - right.chapNum)
  }

  parseChapterDetails(mangaId: string, chapterId: string, html: string): ChapterDetails {
    const reader = /<div[^>]+id=["']readerarea["'][^>]*>([\s\S]*?)<\/div>\s*(?:<div|<script|<\/)/i.exec(html)?.[1] ?? html
    const pages: string[] = []
    const seen: Record<string, boolean> = {}
    const pattern = /(?:data-src|src)=["']([^"']+)["']/gi
    let match: RegExpExecArray | null

    while ((match = pattern.exec(reader)) !== null) {
      const url = this.normalizeUrl(match[1] ?? '')
      if (!/\/wp-content\/uploads\//i.test(url) || seen[url]) continue
      seen[url] = true
      pages.push(url)
    }

    if (pages.length === 0) throw createReaderError('LelManga', mangaId, chapterId, html)
    return App.createChapterDetails({ id: chapterId, mangaId, pages })
  }

  buildCatalogueUrl(page: number, tags: Tag[] = [], parameters: LelMangaSearchParameters = {}, title = ''): string {
    const query: Array<[string, string]> = []
    if (title.trim()) query.push(['s', title.trim()])
    for (const tag of tags) query.push(['genre[]', tag.id])
    if (parameters.status) query.push(['status', parameters.status])
    if (parameters.type) query.push(['type', parameters.type])
    if (parameters.order) query.push(['order', parameters.order])
    if (page > 1) query.push(['page', String(page)])
    const encoded = query.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')
    return `${this.baseUrl}/manga${encoded ? `?${encoded}` : ''}`
  }

  buildSeriesUrl(mangaId: string): string {
    return `${this.baseUrl}/${mangaId.split('/').map(encodeURIComponent).join('/')}`
  }

  buildChapterUrl(chapterId: string): string {
    return `${this.baseUrl}/${encodeURIComponent(chapterId)}`
  }

  normalizeUrl(value: string): string {
    return normalizeHttpUrl(this.decodeText(value).trim(), this.baseUrl)
  }

  private parseGenres(html: string): string[] {
    const block = /<span[^>]+class=["'][^"']*mgen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(html)?.[1] ?? ''
    return Array.from(block.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi), match => this.cleanHtml(match[1] ?? '')).filter(Boolean)
  }

  private infoValue(html: string, label: string): string {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const value = new RegExp(`<div[^>]+class=["'][^"']*imptdt[^"']*["'][^>]*>\\s*${escaped}\\s*([\\s\\S]*?)<\\/div>`, 'i').exec(html)?.[1] ?? ''
    return this.cleanHtml(value)
  }

  private metaContent(html: string, property: string): string {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return this.decodeText(new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i').exec(html)?.[1] ?? '')
  }

  private hasNextPage(html: string, page: number): boolean {
    return new RegExp(`[?&]page=${page + 1}(?:["'&]|$)`, 'i').test(html)
  }

  private chapterNumber(value: string): number {
    const number = Number(value.replace(',', '.'))
    return Number.isFinite(number) ? number : 0
  }

  private parseDate(value: string): Date | undefined {
    return parseDateOrUndefined(value)
  }

  private cleanHtml(value: string): string {
    return this.cleanText(value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
  }

  private cleanText(value: string): string {
    return this.decodeText(value).replace(/\s+/g, ' ').trim()
  }

  private decodeText(value: string): string {
    return value
      .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCharCode(parseInt(code, 16)))
      .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(parseInt(code, 10)))
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;|&#8217;|&rsquo;/g, "'")
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  }

  private tagId(label: string): string {
    return label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  }

  private titleFromId(mangaId: string): string {
    return mangaId.split('/').pop()?.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') ?? mangaId
  }
}
