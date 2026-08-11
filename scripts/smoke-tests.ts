import { MangaDistrictParser } from '../src/MangaDistrict/MangaDistrictParser'
import { LelMangaParser } from '../src/LelManga/LelMangaParser'
import { AstralMangaParser } from '../src/AstralManga/AstralMangaParser'
import { MangasOrigines2026Parser } from '../src/MangasOrigines2026/MangasOrigines2026Parser'
import { OmegaScansParser } from '../src/OmegaScans/OmegaScansParser'
import { PoseidonScansParser } from '../src/PoseidonScans/PoseidonScansParser'

const identity = <T>(value: T): T => value

;(globalThis as unknown as { App: unknown }).App = {
  createChapter: identity,
  createChapterDetails: identity,
  createMangaInfo: identity,
  createPagedResults: identity,
  createPartialSourceManga: identity,
  createTag: identity,
  createTagSection: identity
}

const cases = [
  {
    name: 'Omega Scans',
    url: 'https://omegascans.org/series/my-new-family-treats-me-well/chapter-2',
    parse: (html: string) => new OmegaScansParser('https://omegascans.org', 'https://api.omegascans.org')
      .parseChapterDetails('my-new-family-treats-me-well', 'chapter-2', html).pages
  },
  {
    name: 'MangaDistrict',
    url: 'https://mangadistrict.com/series/crime-and-punishment-daktaryeong-uncensored/chapter-1/',
    parse: (html: string) => new MangaDistrictParser('https://mangadistrict.com')
      .parseChapterDetails('crime-and-punishment-daktaryeong-uncensored', 'chapter-1', html).pages
  },
  {
    name: 'Poseidon Scans',
    url: 'https://poseidon-scans.net/serie/solo-farming-in-the-tower/chapter/120',
    parse: (html: string) => new PoseidonScansParser('https://poseidon-scans.net')
      .parseChapterDetails('solo-farming-in-the-tower', '120', html).pages
  },
  {
    name: 'LelManga',
    url: 'https://www.lelmanga.com/one-piece-1190',
    parse: (html: string) => new LelMangaParser('https://www.lelmanga.com')
      .parseChapterDetails('manga/one-piece', 'one-piece-1190', html).pages
  }
]

async function main(): Promise<void> {
  for (const item of cases) {
    const response = await fetch(item.url, {
      headers: {
        'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
        'user-agent': 'Mozilla/5.0 Paperback source smoke test'
      }
    })

    if (!response.ok) throw new Error(`${item.name}: HTTP ${response.status} for ${item.url}`)
    const pages = item.parse(await response.text())
    if (pages.length === 0) throw new Error(`${item.name}: no reader pages found`)
    console.log(`${item.name}: ${pages.length} reader pages`)
  }

  const omegaParser = new OmegaScansParser('https://omegascans.org', 'https://api.omegascans.org')
  const omegaResponse = await request('https://api.omegascans.org/series/my-new-family-treats-me-well')
  const omegaInfo = omegaParser.parseMangaDetails(JSON.parse(omegaResponse) as Parameters<typeof omegaParser.parseMangaDetails>[0])
  if (omegaInfo.titles.length === 0) throw new Error('Omega Scans: series metadata is empty')

  const districtParser = new MangaDistrictParser('https://mangadistrict.com')
  const districtHtml = await request('https://mangadistrict.com/series/crime-and-punishment-daktaryeong-uncensored/')
  const districtInfo = districtParser.parseMangaDetails('crime-and-punishment-daktaryeong-uncensored', districtHtml)
  if (districtInfo.titles.length === 0) throw new Error('MangaDistrict: series metadata is empty')

  const poseidonParser = new PoseidonScansParser('https://poseidon-scans.net')
  const poseidonHtml = await request('https://poseidon-scans.net/serie/solo-farming-in-the-tower')
  const poseidonInfo = poseidonParser.parseMangaDetails('solo-farming-in-the-tower', poseidonHtml)
  const catalogueHtml = await request('https://poseidon-scans.net/series?sortBy=popular')
  const searchTags = poseidonParser.parseSearchTags(catalogueHtml)
  if (poseidonInfo.titles.length === 0 || (searchTags[0]?.tags.length ?? 0) === 0) {
    throw new Error('Poseidon Scans: series metadata or catalogue tags are empty')
  }

  const lelMangaParser = new LelMangaParser('https://www.lelmanga.com')
  const lelMangaHtml = await request('https://www.lelmanga.com/manga/one-piece')
  const lelMangaInfo = lelMangaParser.parseMangaDetails('manga/one-piece', lelMangaHtml)
  const lelMangaChapters = lelMangaParser.parseChapters('manga/one-piece', lelMangaHtml)
  const lelMangaCatalogue = await request('https://www.lelmanga.com/manga')
  const lelMangaTags = lelMangaParser.parseSearchTags(lelMangaCatalogue)
  const lelMangaResults = lelMangaParser.parseMangaList(lelMangaCatalogue, 1)
  if (lelMangaInfo.titles.length === 0 || lelMangaChapters.length === 0 || lelMangaResults.results.length === 0 || (lelMangaTags[0]?.tags.length ?? 0) === 0) {
    throw new Error('LelManga: catalogue, metadata, chapters or tags are empty')
  }

  console.log(`Series metadata: Omega ${omegaInfo.titles.length}, MangaDistrict ${districtInfo.titles.length}, Poseidon ${poseidonInfo.titles.length}, LelManga ${lelMangaInfo.titles.length} titles`)
  console.log(`Poseidon Scans: ${searchTags[0]?.tags.length ?? 0} catalogue genres`)
  console.log(`LelManga: ${lelMangaResults.results.length} catalogue entries, ${lelMangaChapters.length} chapters, ${lelMangaTags[0]?.tags.length ?? 0} genres`)

  await probeProtectedSource('Epsilon Soft', 'https://epsilonsoft.to/series', html =>
    new PoseidonScansParser('https://epsilonsoft.to', 'Epsilon Soft').parseMangaList(html, 1).results.length)
  await probeProtectedSource('Astral Manga', 'https://astral-manga.fr/catalog', html =>
    new AstralMangaParser('https://astral-manga.fr').parseMangaList(html, 1).results.length)
  await auditMangasOrigines2026()
}

async function auditMangasOrigines2026(): Promise<void> {
  const baseUrl = 'https://mangas-origines.fr'
  const parser = new MangasOrigines2026Parser(baseUrl)
  const cataloguePageRequest = await fetch(`${baseUrl}/catalogues/`, { headers: liveHeaders() })
  const cataloguePage = await cataloguePageRequest.text()
  if (cataloguePageRequest.status === 403 && /cloudflare|cf-chl|attention required|just a moment/i.test(cataloguePage)) {
    console.log('Mangas Origines - 2026: Cloudflare challenge active, live parser check skipped')
    return
  }
  if (!cataloguePageRequest.ok) throw new Error(`Mangas Origines - 2026: catalogue HTTP ${cataloguePageRequest.status}`)
  const tags = parser.parseSearchTags(cataloguePage)
  const body = new URLSearchParams({
    action: 'madara_child_catalogue', s: 'volcanic', genres: '', statut: 'tous', note: '0', origine: '',
    tri: 'recents', chmin: '0', chmax: '0', page: '1', auteur: '', artiste: '', annee: ''
  })
  const catalogueRequest = await fetch(`${baseUrl}/wp-admin/admin-ajax.php?paperback=1`, {
    method: 'POST',
    headers: {
      ...liveHeaders(`${baseUrl}/catalogues/`, 'application/json, text/javascript, */*; q=0.01'),
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'x-requested-with': 'XMLHttpRequest'
    },
    body
  })
  if (!catalogueRequest.ok) throw new Error(`Mangas Origines - 2026: catalogue HTTP ${catalogueRequest.status}`)
  const catalogueResponse = JSON.parse(await catalogueRequest.text()) as {
    success?: boolean
    data?: { html?: string, more?: boolean }
  }
  const catalogue = parser.parseMangaList(catalogueResponse.data?.html ?? '', 1)
  const mangaId = catalogue.results[0]?.mangaId

  if (!catalogueResponse.success || !mangaId || (tags[0]?.tags.length ?? 0) === 0) {
    throw new Error('Mangas Origines - 2026: catalogue AJAX, search or filters are empty')
  }

  const seriesHtml = await request(parser.buildSeriesUrl(mangaId))
  const info = parser.parseMangaDetails(mangaId, seriesHtml)
  const chapters = parser.parseChapterRange(mangaId, seriesHtml)
  const latestChapter = chapters.at(-1)

  if (!latestChapter || info.titles.length === 0 || info.author === 'Unknown' || info.tags[0]?.tags.length === 0) {
    throw new Error('Mangas Origines - 2026: metadata or chapter fallback is empty')
  }

  const readerHtml = await request(parser.buildChapterUrl(mangaId, latestChapter.id))
  const details = parser.parseChapterDetails(mangaId, latestChapter.id, readerHtml)
  const imageResponse = await fetch(details.pages[0] ?? '', { headers: liveHeaders(parser.buildChapterUrl(mangaId, latestChapter.id)) })

  if (!imageResponse.ok || details.pages.length === 0) {
    throw new Error('Mangas Origines - 2026: reader image is unavailable')
  }

  console.log(`Mangas Origines - 2026: ${catalogue.results.length} search entries, ${tags[0]?.tags.length ?? 0} genres, ${chapters.length} fallback chapters, ${details.pages.length} reader pages`)
}

async function probeProtectedSource(name: string, url: string, parse: (html: string) => number): Promise<void> {
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 Paperback source smoke test' } })
  const html = await response.text()
  if (response.status === 403 && /cloudflare|cf-chl|just a moment|un instant/i.test(html)) {
    console.log(`${name}: Cloudflare challenge active, live parser check skipped`)
    return
  }
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status} for ${url}`)
  const count = parse(html)
  if (count === 0) throw new Error(`${name}: live catalogue parser returned no entries`)
  console.log(`${name}: ${count} live catalogue entries`)
}

async function request(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: liveHeaders(undefined, url.includes('api.omegascans.org') ? 'application/json' : 'text/html')
  })

  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  return response.text()
}

function liveHeaders(referer?: string, accept = 'text/html'): Record<string, string> {
  return {
    accept,
    'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    ...(referer ? { referer } : {})
  }
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
