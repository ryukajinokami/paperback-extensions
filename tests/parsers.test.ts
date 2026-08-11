import assert from 'node:assert/strict'
import test from 'node:test'
import { MangaDistrictParser } from '../src/MangaDistrict/MangaDistrictParser'
import { LelMangaParser } from '../src/LelManga/LelMangaParser'
import { AstralMangaParser } from '../src/AstralManga/AstralMangaParser'
import { MangasOrigines2026Parser } from '../src/MangasOrigines2026/MangasOrigines2026Parser'
import { MangasOrigines2026, MangasOrigines2026Info } from '../src/MangasOrigines2026/MangasOrigines2026'
import { OmegaScansParser } from '../src/OmegaScans/OmegaScansParser'
import { PoseidonScansParser } from '../src/PoseidonScans/PoseidonScansParser'
import { createReaderError } from '../src/utils/readerError'
import { isCloudflareChallenge } from '../src/utils/cloudflare'
import { normalizeHttpUrl } from '../src/utils/url'

const identity = <T>(value: T): T => value

;(globalThis as unknown as { App: unknown }).App = {
  createChapter: identity,
  createChapterDetails: identity,
  createMangaInfo: identity,
  createPagedResults: identity,
  createPartialSourceManga: identity,
  createRequest: identity,
  createRequestManager: (info: Record<string, unknown>) => ({
    ...info,
    requestsPerSecond: 1,
    requestTimeout: 20000,
    getDefaultUserAgent: async () => 'Paperback Test',
    schedule: async () => { throw new Error('Unexpected request') }
  }),
  createTag: identity,
  createTagSection: identity
}

test('shared URL normalizer unwraps proxies and encodes reader filenames', () => {
  assert.equal(
    normalizeHttpUrl('/_next/image?url=%2Fapi%2Fcovers%2FS%C3%A9rie%20Test.webp&w=640', 'https://example.com'),
    'https://example.com/api/covers/S%C3%A9rie%20Test.webp'
  )
  assert.equal(
    normalizeHttpUrl('https://cdn.example.com/chapter/01 kopya.jpg', 'https://example.com'),
    'https://cdn.example.com/chapter/01%20kopya.jpg'
  )
})

test('Cloudflare telemetry on a readable page is not treated as a challenge', () => {
  const readablePage = `<html><head><title>Catalogue</title></head><body>
    <article class="page-item-detail">Manga</article>
    <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>
  </body></html>`

  assert.equal(isCloudflareChallenge(readablePage), false)
  assert.equal(isCloudflareChallenge('<html><head><title>Just a moment...</title></head></html>'), true)
  assert.equal(isCloudflareChallenge('<script>window._cf_chl_opt = {};</script>'), true)
})

test('OmegaScans accepts reader image filenames containing spaces', () => {
  const parser = new OmegaScansParser('https://omegascans.org', 'https://api.omegascans.org')
  const html = '<img class="block object-contain h-auto" src="https://media.omegascans.org/file/key/uploads/series/example/chapter/01 kopya.jpg">'
  const details = parser.parseChapterDetails('example', 'chapter-2', html)

  assert.deepEqual(details.pages, [
    'https://media.omegascans.org/file/key/uploads/series/example/chapter/01%20kopya.jpg'
  ])
})

test('MangaDistrict keeps only chapter reader images', () => {
  const parser = new MangaDistrictParser('https://mangadistrict.com')
  const html = `
    <div class="reading-content">
      <img class="wp-manga-chapter-img" data-src="https://cdn.mangadistrict.com/publication/example/chapter-1/001.jpg">
      <img class="wp-manga-chapter-img" src="https://cdn.mangadistrict.com/publication/example/chapter-1/002.avif">
      <img class="wp-manga-chapter-img" src="https://mangadistrict.com/wp-content/logo.png">
    </div>
  `
  const details = parser.parseChapterDetails('example', 'chapter-1', html)

  assert.deepEqual(details.pages, [
    'https://cdn.mangadistrict.com/publication/example/chapter-1/001.jpg',
    'https://cdn.mangadistrict.com/publication/example/chapter-1/002.avif'
  ])
})

test('OmegaScans and MangaDistrict expose useful additional metadata', () => {
  const omega = new OmegaScansParser('https://omegascans.org', 'https://api.omegascans.org')
  const omegaInfo = omega.parseMangaDetails({
    id: 1,
    title: 'Example',
    alternative_names: 'Example Alt | Exemple',
    series_slug: 'example',
    series_type: 'Comic',
    total_views: 1234,
    meta: { chapters_count: '12', who_bookmarked_count: '34' }
  }) as unknown as { titles: string[], additionalInfo: Record<string, string> }
  const mangaDistrict = new MangaDistrictParser('https://mangadistrict.com')
  const districtInfo = mangaDistrict.parseMangaDetails('example', `
    <div class="post-title"><h1>Example</h1></div>
    <div class="description-summary"><div class="summary__content">Description</div></div>
    <div class="summary-heading"><h5> Alternative </h5></div><div class="summary-content">Example Alt, Exemple</div>
    <div class="summary-heading"><h5> Type </h5></div><div class="summary-content">Manhwa</div>
    <div class="summary-heading"><h5> Release </h5></div><div class="summary-content">2025</div>
    <div class="summary-heading"><h5> Status </h5></div><div class="summary-content">OnGoing</div>
  `) as unknown as { titles: string[], additionalInfo: Record<string, string> }

  assert.deepEqual(omegaInfo.titles, ['Example', 'Example Alt', 'Exemple'])
  assert.deepEqual(omegaInfo.additionalInfo, { Type: 'Comic', Views: '1234', Chapters: '12', Bookmarks: '34' })
  assert.deepEqual(districtInfo.titles, ['Example', 'Example Alt', 'Exemple'])
  assert.deepEqual(districtInfo.additionalInfo, { Type: 'Manhwa', Release: '2025', Status: 'OnGoing' })
})

test('PoseidonScans exposes catalogue tags and builds filtered URLs', () => {
  const parser = new PoseidonScansParser('https://poseidon-scans.net')
  const html = '<script>self.__next_f.push([1,"{\\"allTags\\":[\\"Action\\",\\"Académie\\"],\\"allTypes\\":[\\"MANGA\\",\\"MANHWA\\"]}"])</script>'
  const sections = parser.parseSearchTags(html)
  const filters = parser.splitSearchTags([
    { id: 'genre:Action', label: 'Action' },
    { id: 'type:MANHWA', label: 'MANHWA' },
    { id: 'status:en cours', label: 'En cours' }
  ])

  assert.equal(sections[0]?.tags.length, 2)
  assert.equal(sections[1]?.tags.length, 2)
  assert.deepEqual(filters, { tags: ['Action', 'MANHWA'], status: 'en cours' })
  assert.equal(
    parser.buildSearchUrl('solo', 2, filters, { sortBy: 'popular', minChapters: '10' }),
    'https://poseidon-scans.net/series?search=solo&tags=Action%2CMANHWA&status=en%20cours&sortBy=popular&minChapters=10&page=2'
  )
})

test('PoseidonScans parses free chapters, metadata and reader pages', () => {
  const parser = new PoseidonScansParser('https://poseidon-scans.net')
  const seriesHtml = `
    <script type="application/ld+json">{"@type":"ComicSeries","name":"Example","description":"Description","genre":["Action"],"image":"/api/covers/example.webp"}</script>
    <script>self.__next_f.push([1,"{\\"type\\":\\"font/woff2\\"}"])</script>
    <script>self.__next_f.push([1,"{\\"type\\":\\"MANHWA\\",\\"status\\":\\"en cours\\",\\"viewCount\\":1234,\\"releaseYear\\":2025,\\"alternativeNames\\":\\"Example Alt | Exemple\\",\\"_count\\":{\\"favorites\\":42},\\"chapters\\":[{\\"id\\":\\"free\\",\\"number\\":1,\\"title\\":null,\\"createdAt\\":\\"$D2026-01-01T00:00:00.000Z\\",\\"isPremium\\":false,\\"premiumUntil\\":null},{\\"id\\":\\"paid\\",\\"number\\":2,\\"title\\":null,\\"createdAt\\":\\"$D2026-01-02T00:00:00.000Z\\",\\"isPremium\\":true,\\"premiumUntil\\":null}]}"])</script>
  `
  const info = parser.parseMangaDetails('example', seriesHtml) as unknown as { titles: string[], additionalInfo: Record<string, string> }
  const chapters = parser.parseChapters('example', seriesHtml)
  const details = parser.parseChapterDetails(
    'example',
    '1',
    '<img src="https://poseidon-scans.net/api/chapters/example/chapter-id/page-id">'
  )

  assert.deepEqual(info.titles, ['Example', 'Example Alt', 'Exemple'])
  assert.deepEqual(info.additionalInfo, { Type: 'MANHWA', Year: '2025', Views: '1234', Favorites: '42' })
  assert.equal(chapters.length, 1)
  assert.equal(chapters[0]?.id, '1')
  assert.deepEqual(details.pages, ['https://poseidon-scans.net/api/chapters/example/chapter-id/page-id'])
})

test('PoseidonScans restores shuffled reader pages and preserves the HTML fallback order', () => {
  const parser = new PoseidonScansParser('https://poseidon-scans.net')
  const pageUrl = (page: number): string => `https://poseidon-scans.net/api/chapters/example/chapter-id/page-${page}`
  const readerBlock = (page: number, order: string): string => `
    <div class="reader-vimg" data-sequence="${order}" data-order="${order}">
      <div><img src="${pageUrl(page)}"></div>
    </div>`

  const shuffled = readerBlock(3, '3') + readerBlock(1, '1') + readerBlock(2, '2')
  assert.deepEqual(parser.parseChapterDetails('example', '1', shuffled).pages, [pageUrl(1), pageUrl(2), pageUrl(3)])

  const incomplete = readerBlock(2, '2') + `<img src="${pageUrl(1)}">`
  assert.deepEqual(parser.parseChapterDetails('example', '1', incomplete).pages, [pageUrl(2), pageUrl(1)])

  const duplicateOrders = readerBlock(2, '1') + readerBlock(1, '1')
  assert.deepEqual(parser.parseChapterDetails('example', '1', duplicateOrders).pages, [pageUrl(2), pageUrl(1)])
})

test('reader diagnostics distinguish restricted chapters and missing pages', () => {
  assert.match(
    createReaderError('Poseidon Scans', 'example', '2', '<h1>Accès Restreint</h1>').message,
    /premium or not public yet/
  )
  assert.match(
    createReaderError('Omega Scans', 'example', '404', '<title>404 - This page could not be found</title>').message,
    /chapter page was not found/
  )
})

test('LelManga parses catalogue filters, chapters, metadata and reader pages', () => {
  const parser = new LelMangaParser('https://www.lelmanga.com')
  const catalogue = `
    <input type="checkbox" name="genre[]" value="11"><label>Action</label>
    <div class="bs"><div class="bsx"><a href="https://www.lelmanga.com/manga/example" title="Example">
      <img src="https://i0.wp.com/www.lelmanga.com/wp-content/uploads/example.webp"><div class="tt">Example</div><div class="epxs">Chapitre 12</div>
    </a></div></div><a href="/manga?page=2">2</a>
  `
  const series = `
    <div class="thumb"><img src="https://i0.wp.com/www.lelmanga.com/wp-content/uploads/cover.webp"></div>
    <h1 class="entry-title">Example</h1><span class="mgen"><a>Action</a></span>
    <div class="entry-content entry-content-single"><p>Description</p></div>
    <div class="imptdt">Statut <i>En cours</i></div><div class="imptdt">Type <a>Manga</a></div>
    <div class="bmc">Followed by 42 people</div><div itemprop="ratingValue" content="9.5"></div>
    <div class="eplister"><ul><li data-num="12"><a href="https://www.lelmanga.com/example-12">
      <span class="chapternum">Chapitre 12</span><span class="chapterdate">August 9, 2026</span></a></li></ul></div>
  `
  const results = parser.parseMangaList(catalogue, 1)
  const tags = parser.parseSearchTags(catalogue)
  const info = parser.parseMangaDetails('manga/example', series) as unknown as { additionalInfo: Record<string, string> }
  const chapters = parser.parseChapters('manga/example', series)
  const details = parser.parseChapterDetails('manga/example', 'example-12', '<div id="readerarea"><img src="https://www.lelmanga.com/wp-content/uploads/example/001.webp"></div><script></script>')

  assert.equal(results.results[0]?.mangaId, 'manga/example')
  assert.deepEqual(results.metadata, { page: 2 })
  assert.equal(tags[0]?.tags[0]?.label, 'Action')
  assert.deepEqual(info.additionalInfo, { Type: 'Manga', Followers: '42' })
  assert.equal(chapters[0]?.id, 'example-12')
  assert.deepEqual(details.pages, ['https://www.lelmanga.com/wp-content/uploads/example/001.webp'])
  assert.equal(
    parser.buildCatalogueUrl(2, [{ id: '11', label: 'Action' }], { status: 'ongoing', order: 'popular' }, 'one piece'),
    'https://www.lelmanga.com/manga?s=one%20piece&genre%5B%5D=11&status=ongoing&order=popular&page=2'
  )
})

test('Epsilon-compatible parser uses the selected source name and routes', () => {
  const parser = new PoseidonScansParser('https://epsilonsoft.to', 'Epsilon Soft')
  const chapters = parser.parseChapters('regas', '<script>{"chapters":[{"id":"id","number":98,"title":null,"createdAt":"$D2026-06-27T00:00:00.000Z","isPremium":false,"premiumUntil":null}]}</script>')
  assert.equal(chapters[0]?.group, 'Epsilon Soft')
  assert.equal(parser.buildSeriesUrl('regas'), 'https://epsilonsoft.to/serie/regas')
  assert.equal(parser.buildChapterUrl('regas', '98'), 'https://epsilonsoft.to/serie/regas/chapter/98')
})

test('chapter date fallbacks do not invent the current date', () => {
  const hasTime = (chapter: unknown): boolean => Object.prototype.hasOwnProperty.call(chapter, 'time')
  const omega = new OmegaScansParser('https://omegascans.org', 'https://api.omegascans.org')
  const mangaDistrict = new MangaDistrictParser('https://mangadistrict.com')
  const mangasOrigines2026 = new MangasOrigines2026Parser('https://mangas-origines.fr')
  const poseidon = new PoseidonScansParser('https://poseidon-scans.net')
  const epsilon = new PoseidonScansParser('https://epsilonsoft.to', 'Epsilon Soft')
  const lelManga = new LelMangaParser('https://www.lelmanga.com')
  const astral = new AstralMangaParser('https://astral-manga.fr')

  const omegaChapters = omega.parseChapters({ data: [{ id: 1, chapter_name: 'Chapter 1', chapter_slug: 'chapter-1', created_at: 'not a date' }] })
  assert.equal(hasTime(omegaChapters[0]), false)

  const districtChapters = mangaDistrict.parseChapters('example', '<li class="wp-manga-chapter"><a href="https://mangadistrict.com/series/example/chapter-1/">Chapter 1</a><span class="timediff"><i>not a date</i></span></li>')
  assert.equal(hasTime(districtChapters[0]), false)

  const originChapters = mangasOrigines2026.parseChapters('example', '<div class="ori-chl-row"><a class="ori-chl-lire" href="https://mangas-origines.fr/oeuvre/example/chapitre-1/">Chapitre 1</a></div>')
  assert.equal(hasTime(originChapters[0]), false)
  assert.equal(hasTime(mangasOrigines2026.parseChapterRange('example', '<a class="ori-chl-lire" href="https://mangas-origines.fr/oeuvre/example/chapitre-3/">Chapitre 3</a>')[0]), false)

  const poseidonChapters = poseidon.parseChapters('example', '<a href="/serie/example/chapter/1"><h3>Chapitre 1</h3></a>')
  assert.equal(hasTime(poseidonChapters[0]), false)

  const epsilonChapters = epsilon.parseChapters('example', '<a href="/serie/example/chapter/1"><h3>Chapitre 1</h3></a>')
  assert.equal(epsilonChapters[0]?.group, 'Epsilon Soft')
  assert.equal(hasTime(epsilonChapters[0]), false)

  const lelChapters = lelManga.parseChapters('manga/example', '<div class="eplister"><ul><li data-num="1"><a href="/example-1"><span class="chapternum">Chapitre 1</span><span class="chapterdate">not a date</span></a></li></ul></div>')
  assert.equal(hasTime(lelChapters[0]), false)

  const astralChapters = astral.parseChapters('01b2c442-e484-4d77-a07a-c2714b718d24', '<a href="/manga/01b2c442-e484-4d77-a07a-c2714b718d24/chapter/293db8d9-6f01-4911-b6f1-045298b20c79">Chapitre 173</a>')
  assert.equal(hasTime(astralChapters[0]), false)
})

test('Mangas Origines - 2026 supports its customized Madara routes and WordPress reader', () => {
  assert.equal(MangasOrigines2026Info.name, 'Mangas Origines - 2026')
  assert.equal(MangasOrigines2026Info.contentRating, 'MATURE')
  const parser = new MangasOrigines2026Parser('https://mangas-origines.fr')
  const catalogue = `<div class="ori-listing-grid ori-cat-grid">
    <a class="ori-card ori-cat-card" href="https://mangas-origines.fr/oeuvre/example/">
      <span class="ori-card-cover"><img src="https://mangas-origines.fr/wp-content/uploads/example.webp" alt="Example"></span>
      <span class="ori-card-title">Example &amp; Test</span><span class="ori-card-sub">Action &middot; Manhwa</span>
    </a>
  </div>`
  const chapters = `<div class="ori-chl-row">
    <a class="ori-chl-lire" href="https://mangas-origines.fr/oeuvre/example/chapitre-1/">Chapitre 1</a>
    <span class="ori-chl-date">9 août 2026</span>
  </div>
  <div class="ori-chl-row">
    <span class="ori-chl-date">10/08/2026</span>
    <a class="ori-chl-lire" href="https://mangas-origines.fr/oeuvre/example/chapitre-12/">Chapitre 12</a>
  </div>`
  const series = `<link rel="canonical" href="https://mangas-origines.fr/oeuvre/example/">
    <meta property="og:image" content="https://mangas-origines.fr/wp-content/uploads/example.webp">
    <div class="post-title"><h1>Example</h1></div>
    <div class="ori-sr-signature"><a>Signature Fallback</a></div>
    <div class="ori-sr-genres"><a href="https://mangas-origines.fr/manga-genres/action/">Action</a></div>
    <div class="ori-sr-infos"><dl>
      <dt>Statut</dt><dd>En cours</dd>
      <dt>Type</dt><dd>Manhwa</dd>
      <dt>Sc&eacute;nario</dt><dd><a>Example Author</a></dd>
      <dt>Dessin</dt><dd><a>Example Artist</a></dd>
    </dl></div>
    <div class="ori-sr-syn-texte"><p>Modern synopsis.</p></div>`
  const filters = '<label class="ori-fcheck"><input type="checkbox" value="action"><span class="ori-flabel">Action</span></label>'
  const reader = '<div class="reading-content"><img class="wp-manga-chapter-img" data-src="https://mangas-origines.fr/wp-content/uploads/example/chapter-1/001.webp"></div>'
  const results = parser.parseMangaList(catalogue, 1)
  const chapterResults = parser.parseChapters('example', chapters)
  const chapterFallback = parser.parseChapterRange('example', chapters)
  const redirectedSearch = parser.parseMangaList(series, 1)
  const info = parser.parseMangaDetails('example', series)
  const tags = parser.parseSearchTags(filters)
  const details = parser.parseChapterDetails('example', 'chapter-1', reader)
  assert.equal(results.results[0]?.mangaId, 'example')
  assert.equal(results.results[0]?.title, 'Example & Test')
  assert.equal(results.results[0]?.subtitle, 'Action · Manhwa')
  assert.equal(results.results[0]?.image, 'https://mangas-origines.fr/wp-content/uploads/example.webp')
  assert.equal(chapterResults.at(-1)?.id, 'chapitre-12')
  assert.equal(chapterResults.at(-1)?.chapNum, 12)
  assert.equal(chapterResults[0]?.group, 'Mangas Origines - 2026')
  assert.equal(chapterResults[0]?.time?.getTime(), new Date(2026, 7, 9).getTime())
  assert.equal(chapterResults.at(-1)?.time?.getTime(), new Date(2026, 7, 10).getTime())
  assert.equal(chapterFallback.length, 12)
  assert.equal(redirectedSearch.results[0]?.mangaId, 'example')
  assert.equal(info.author, 'Example Author')
  assert.equal(info.artist, 'Example Artist')
  assert.equal(info.status, 'En cours')
  assert.equal(info.desc, 'Modern synopsis.')
  assert.equal(info.tags[0]?.tags[0]?.id, 'action')
  assert.equal(info.additionalInfo.Type, 'Manhwa')
  assert.equal(tags[0]?.tags[0]?.id, 'action')
  assert.deepEqual(details.pages, ['https://mangas-origines.fr/wp-content/uploads/example/chapter-1/001.webp'])
  assert.equal(parser.buildArchiveUrl('modified', 1), 'https://mangas-origines.fr/catalogues/?m_orderby=modified')
  assert.equal(parser.buildChapterUrl('example', 'chapter-1'), 'https://mangas-origines.fr/oeuvre/example/chapter-1/')
  assert.equal(parser.buildChaptersUrl('example'), 'https://mangas-origines.fr/oeuvre/example/ajax/chapters/?t=1&paperback=1')
})

test('Mangas Origines - 2026 sends catalogue filters through the marked AJAX endpoint', async () => {
  const source = new MangasOrigines2026()
  const requests: Array<{ url: string, method: string, data: unknown }> = []
  const html = '<a class="ori-card ori-cat-card" href="https://mangas-origines.fr/oeuvre/volcanic-age/"><img src="/cover.webp" alt="Volcanic Age"><span class="ori-card-title">Volcanic Age</span></a>'

  ;(source.requestManager as unknown as { schedule: (request: typeof requests[number]) => Promise<unknown> }).schedule = async request => {
    requests.push(request)
    return { status: 200, data: JSON.stringify({ success: true, data: { html, more: false } }), headers: {}, request }
  }

  const results = await source.getSearchResults({
    title: 'volcanic',
    includedTags: [{ id: 'action', label: 'Action' }],
    excludedTags: [],
    parameters: { orderBy: 'rating' }
  }, undefined)

  assert.equal(results.results[0]?.mangaId, 'volcanic-age')
  assert.equal(requests[0]?.url, 'https://mangas-origines.fr/wp-admin/admin-ajax.php?paperback=1')
  assert.equal(requests[0]?.method, 'POST')
  assert.equal(typeof requests[0]?.data, 'string')
  const body = new URLSearchParams(String(requests[0]?.data))
  assert.equal(body.get('action'), 'madara_child_catalogue')
  assert.equal(body.get('s'), 'volcanic')
  assert.equal(body.get('genres'), 'action')
  assert.equal(body.get('tri'), 'notes')
})

test('Astral Manga parses UUID routes and selects the chapter image directory', () => {
  const parser = new AstralMangaParser('https://astral-manga.fr')
  const mangaId = '01b2c442-e484-4d77-a07a-c2714b718d24'
  const chapterId = '293db8d9-6f01-4911-b6f1-045298b20c79'
  const catalogue = `<a href="/manga/${mangaId}"><script src="/_next/static/chunks/app.js"></script><img src="/uploads/covers/example.webp" alt="Example"></a>`
  const series = `<h1>Example</h1><a href="/manga/${mangaId}/chapter/${chapterId}">Chapitre 173</a>`
  const reader = '<script src="/_next/static/chunks/app.js"></script><img src="/images/logo.png"><script>{"images":["/uploads/chapters/example/001.webp","/uploads/chapters/example/002.webp"],"cover":"/uploads/covers/example.webp"}</script>'
  const result = parser.parseMangaList(catalogue, 1).results[0]
  assert.equal(result?.mangaId, mangaId)
  assert.equal(result?.image, 'https://astral-manga.fr/uploads/covers/example.webp')
  assert.equal(parser.parseChapters(mangaId, series)[0]?.chapNum, 173)
  assert.deepEqual(parser.parseChapterDetails(mangaId, chapterId, reader).pages, [
    'https://astral-manga.fr/uploads/chapters/example/001.webp',
    'https://astral-manga.fr/uploads/chapters/example/002.webp'
  ])
  assert.throws(() => parser.parseChapterDetails(mangaId, chapterId, '<script src="/_next/static/chunks/app.js"></script>'))
  assert.equal(parser.buildCatalogueUrl(1, '', [{ id: 'Action', label: 'Action' }]), 'https://astral-manga.fr/catalog?tags=Action')
})
