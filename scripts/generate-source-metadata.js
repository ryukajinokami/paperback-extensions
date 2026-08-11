const fs = require('fs')
const path = require('path')

const rootDirectory = path.resolve(__dirname, '..')
const bundlesDirectory = path.join(rootDirectory, 'bundles')
const metadataDirectory = path.join(rootDirectory, 'metadata')
const versioningPath = path.join(bundlesDirectory, 'versioning.json')

const sourceInfoFields = [
  { key: 'version', required: true },
  { key: 'name', required: true },
  { key: 'icon', required: true },
  { key: 'author', required: true },
  { key: 'description', required: true },
  { key: 'contentRating', required: true },
  { key: 'websiteBaseURL', required: true },
  { key: 'authorWebsite', required: false },
  { key: 'language', required: false },
  { key: 'sourceTags', required: false },
  { key: 'intents', required: false }
]

const intentNames = [
  [1, 'MANGA_CHAPTERS'],
  [2, 'MANGA_TRACKING'],
  [4, 'HOMEPAGE_SECTIONS'],
  [8, 'COLLECTION_MANAGEMENT'],
  [16, 'CLOUDFLARE_BYPASS_REQUIRED'],
  [32, 'SETTINGS_UI']
]

const mangaInfoFields = [
  'image', 'artist', 'author', 'desc', 'status', 'hentai', 'titles', 'banner', 'rating',
  'tags', 'covers', 'additionalInfo', 'avgRating', 'follows', 'langFlag', 'langName',
  'users', 'views'
]

const chapterFields = ['id', 'chapNum', 'langCode', 'name', 'volume', 'group', 'time', 'sortingIndex']
const chapterDetailsFields = ['id', 'mangaId', 'pages']

if (!fs.existsSync(versioningPath)) {
  throw new Error('bundles/versioning.json is missing; run npm run build first')
}

const versioning = JSON.parse(fs.readFileSync(versioningPath, 'utf8'))
fs.mkdirSync(metadataDirectory, { recursive: true })

for (const source of versioning.sources ?? []) {
  const bundlePath = path.join(bundlesDirectory, source.id, 'index.js')
  const bundle = require(bundlePath)
  const sourceInfo = bundle[`${source.id}Info`]
  if (!sourceInfo) {
    throw new Error(`SourceInfo export not found for ${source.id}`)
  }

  const output = { id: source.id }
  const missing = {}

  for (const field of sourceInfoFields) {
    const value = sourceInfo[field.key]
    const isMissing = value === undefined || value === null || value === ''
    output[field.key] = isMissing ? null : value

    if (isMissing) {
      missing[field.key] = field.required
        ? 'NOT_FOUND: required Paperback metadata is missing.'
        : 'NOT_FOUND: optional Paperback metadata is not configured.'
    }
  }

  output.intentNames = intentNames
    .filter(([value]) => typeof output.intents === 'number' && (output.intents & value) !== 0)
    .map(([, name]) => name)
  output._missing = missing
  output._contract = '@paperback/types SourceInfo, MangaInfo, Chapter and ChapterDetails 0.8.0-alpha.38'

  const metadataPath = path.join(metadataDirectory, `${source.id}.json`)
  output.manga = untestedManga()
  output.chapter = untestedChapter()
  if (fs.existsSync(metadataPath)) {
    const previous = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    if (previous.manga) output.manga = previous.manga
    if (previous.chapter) output.chapter = previous.chapter
  }

  fs.writeFileSync(
    metadataPath,
    `${JSON.stringify(output, null, 2)}\n`
  )
}

console.log(`Generated ${versioning.sources.length} Paperback metadata files in metadata/`)

function untestedManga() {
  const metadata = {}
  const missing = {}
  for (const field of mangaInfoFields) {
    metadata[field] = null
    missing[field] = 'NOT_FOUND: live metadata test has not been run.'
  }
  metadata._missing = missing

  return {
    fetchStatus: 'NOT_TESTED',
    mangaId: null,
    shareUrl: null,
    fetchedAt: null,
    metadata,
    error: 'Run npm run test:metadata to fetch a real manga.'
  }
}

function untestedChapter() {
  const metadata = emptyMetadata(chapterFields, 'NOT_FOUND: live chapter test has not been run.')
  const details = emptyMetadata(chapterDetailsFields, 'NOT_FOUND: live chapter details test has not been run.')

  return {
    fetchStatus: 'NOT_TESTED',
    mangaId: null,
    chapterCount: null,
    fetchedAt: null,
    metadata,
    details: {
      fetchStatus: 'NOT_TESTED',
      fetchedAt: null,
      metadata: details,
      error: 'Run npm run test:metadata to fetch a real chapter.'
    },
    error: 'Run npm run test:metadata to fetch a real chapter.'
  }
}

function emptyMetadata(fields, message) {
  const metadata = {}
  const missing = {}
  for (const field of fields) {
    metadata[field] = null
    missing[field] = message
  }
  metadata._missing = missing
  return metadata
}
