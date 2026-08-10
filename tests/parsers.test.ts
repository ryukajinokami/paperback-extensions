import assert from 'node:assert/strict'
import test from 'node:test'
import { MangaDistrictParser } from '../src/MangaDistrict/MangaDistrictParser'
import { LelMangaParser } from '../src/LelManga/LelMangaParser'
import { OmegaScansParser } from '../src/OmegaScans/OmegaScansParser'
import { PoseidonScansParser } from '../src/PoseidonScans/PoseidonScansParser'
import { createReaderError } from '../src/utils/readerError'
import { normalizeHttpUrl } from '../src/utils/url'

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
      <img class="wp-manga-chapter-img" src="https://mangadistrict.com/wp-content/logo.png">
    </div>
  `
  const details = parser.parseChapterDetails('example', 'chapter-1', html)

  assert.deepEqual(details.pages, [
    'https://cdn.mangadistrict.com/publication/example/chapter-1/001.jpg'
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
