import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import test from 'node:test'
import type { Chapter, ChapterDetails, MangaInfo, Request, Response, SourceInfo, SourceInterceptor, SourceManga } from '@paperback/types'
import { chromium } from 'playwright-core'
import type { Browser, Page } from 'playwright-core'
import { AstralManga, AstralMangaInfo } from '../src/AstralManga/AstralManga'
import { EpsilonSoft, EpsilonSoftInfo } from '../src/EpsilonSoft/EpsilonSoft'
import { LelManga, LelMangaInfo } from '../src/LelManga/LelManga'
import { MangaDistrict, MangaDistrictInfo } from '../src/MangaDistrict/MangaDistrict'
import { MangasOrigines, MangasOriginesInfo } from '../src/MangasOrigines/MangasOrigines'
import { OmegaScans, OmegaScansInfo } from '../src/OmegaScans/OmegaScans'
import { PoseidonScans, PoseidonScansInfo } from '../src/PoseidonScans/PoseidonScans'

interface LiveSource {
  getMangaDetails(mangaId: string): Promise<SourceManga>
  getChapters(mangaId: string): Promise<Chapter[]>
  getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails>
  getMangaShareUrl(mangaId: string): string
}

interface MetadataCase {
  id: string
  info: SourceInfo
  mangaId: string
  expectedReachable: boolean
  createSource: () => LiveSource
}

interface FieldSpec {
  key: string
  required: boolean
}

interface BrowserSession {
  browser: Browser
  page: Page
}

interface BrowserHost {
  browser: Browser
  process: ChildProcess
  profileDirectory: string
}

const mangaInfoFields: FieldSpec[] = [
  { key: 'image', required: true },
  { key: 'artist', required: true },
  { key: 'author', required: true },
  { key: 'desc', required: true },
  { key: 'status', required: true },
  { key: 'hentai', required: true },
  { key: 'titles', required: true },
  { key: 'banner', required: false },
  { key: 'rating', required: false },
  { key: 'tags', required: true },
  { key: 'covers', required: true },
  { key: 'additionalInfo', required: false },
  { key: 'avgRating', required: false },
  { key: 'follows', required: false },
  { key: 'langFlag', required: false },
  { key: 'langName', required: false },
  { key: 'users', required: false },
  { key: 'views', required: false }
]

const chapterFields: FieldSpec[] = [
  { key: 'id', required: true },
  { key: 'chapNum', required: true },
  { key: 'langCode', required: true },
  { key: 'name', required: true },
  { key: 'volume', required: true },
  { key: 'group', required: true },
  { key: 'time', required: true },
  { key: 'sortingIndex', required: true }
]

const chapterDetailsFields: FieldSpec[] = [
  { key: 'id', required: true },
  { key: 'mangaId', required: true },
  { key: 'pages', required: true }
]

const cases: MetadataCase[] = [
  {
    id: 'OmegaScans',
    info: OmegaScansInfo,
    mangaId: 'my-new-family-treats-me-well',
    expectedReachable: true,
    createSource: () => new OmegaScans()
  },
  {
    id: 'MangaDistrict',
    info: MangaDistrictInfo,
    mangaId: 'crime-and-punishment-daktaryeong-uncensored',
    expectedReachable: true,
    createSource: () => new MangaDistrict()
  },
  {
    id: 'PoseidonScans',
    info: PoseidonScansInfo,
    mangaId: 'solo-farming-in-the-tower',
    expectedReachable: true,
    createSource: () => new PoseidonScans()
  },
  {
    id: 'LelManga',
    info: LelMangaInfo,
    mangaId: 'manga/one-piece',
    expectedReachable: true,
    createSource: () => new LelManga()
  },
  {
    id: 'EpsilonSoft',
    info: EpsilonSoftInfo,
    mangaId: 'regas',
    expectedReachable: false,
    createSource: () => new EpsilonSoft()
  },
  {
    id: 'AstralManga',
    info: AstralMangaInfo,
    mangaId: '01b2c442-e484-4d77-a07a-c2714b718d24',
    expectedReachable: false,
    createSource: () => new AstralManga()
  },
  {
    id: 'MangasOrigines',
    info: MangasOriginesInfo,
    mangaId: '826-solo-leveling',
    expectedReachable: false,
    createSource: () => new MangasOrigines()
  }
]

const identity = <T>(value: T): T => value

;(globalThis as unknown as { App: unknown }).App = {
  createChapter: identity,
  createChapterDetails: identity,
  createHomeSection: identity,
  createMangaInfo: identity,
  createPagedResults: identity,
  createPartialSourceManga: identity,
  createRequest: (info: Partial<Request>): Request => ({
    url: info.url ?? '',
    method: info.method ?? 'GET',
    headers: info.headers ?? {},
    cookies: info.cookies ?? [],
    ...(info.data === undefined ? {} : { data: info.data }),
    ...(info.param === undefined ? {} : { param: info.param })
  }),
  createRequestManager: (info: { interceptor?: SourceInterceptor, requestsPerSecond?: number, requestTimeout?: number }) => ({
    interceptor: info.interceptor,
    requestsPerSecond: info.requestsPerSecond ?? 1,
    requestTimeout: info.requestTimeout ?? 20000,
    getDefaultUserAgent: async () => liveUserAgent,
    schedule: (request: Request) => scheduleRequest(request, info.interceptor, info.requestTimeout ?? 20000)
  }),
  createSearchField: identity,
  createSourceManga: identity,
  createTag: identity,
  createTagSection: identity
}

const liveUserAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const metadataDirectory = path.resolve(__dirname, '..', 'metadata')
const browserSessions = new Map<string, BrowserSession>()
let terminalPrompt: ReturnType<typeof createInterface> | undefined
let browserHost: BrowserHost | undefined

if (process.env.PAPERBACK_METADATA_SCRIPT === '1') {
  void runMetadata().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  test('real sources export SourceInfo, MangaInfo, Chapter and ChapterDetails JSON', runMetadata)
}

async function runMetadata(): Promise<void> {
  fs.mkdirSync(metadataDirectory, { recursive: true })
  const requiredFailures: string[] = []

  try {
    for (const item of cases) {
      const source = item.createSource()
      const document = sourceDocument(item)
      const targetUrl = source.getMangaShareUrl(item.mangaId)
      const mangaAttempt = await withCloudflareRetry(item.id, targetUrl, () => source.getMangaDetails(item.mangaId))
      const result = mangaAttempt.value

      if (result) {
        assert.equal(result.id, item.mangaId)
        assert.ok(result.mangaInfo.titles.length > 0, `${item.id}: manga titles are empty`)

        document.manga = {
          fetchStatus: 'FOUND',
          mangaId: result.id,
          shareUrl: source.getMangaShareUrl(result.id),
          fetchedAt: new Date().toISOString(),
          metadata: normalizeMangaInfo(result.mangaInfo),
          error: null
        }
        console.log(`${item.id}: fetched ${result.mangaInfo.titles[0]}`)

        const chaptersAttempt = await withCloudflareRetry(item.id, targetUrl, () => source.getChapters(item.mangaId))
        const chapters = chaptersAttempt.value
        const chapter = chapters ? selectLatestChapter(chapters) : undefined

        if (chapter) {
          const detailsAttempt = await withCloudflareRetry(
            item.id,
            targetUrl,
            () => source.getChapterDetails(item.mangaId, chapter.id)
          )
          const details = detailsAttempt.value

          document.chapter = {
            fetchStatus: 'FOUND',
            mangaId: item.mangaId,
            chapterCount: chapters?.length ?? 0,
            fetchedAt: new Date().toISOString(),
            metadata: normalizeChapter(chapter),
            details: details
              ? availableChapterDetails(details)
              : unavailableChapterDetails(chapter.id, detailsAttempt.error),
            error: null
          }
          console.log(`${item.id}: fetched chapter ${chapter.chapNum} (${details?.pages.length ?? 0} pages)`)

          if (!details && item.expectedReachable) {
            requiredFailures.push(`${item.id} chapter ${chapter.id}: ${errorMessage(detailsAttempt.error)}`)
          }
        } else {
          const chapterError = chaptersAttempt.error ?? new Error(`${item.id}: chapter list is empty`)
          document.chapter = unavailableChapter(item.mangaId, chapterError)
          console.log(`${item.id}: chapter failed - ${errorMessage(chapterError)}`)

          if (item.expectedReachable) {
            requiredFailures.push(`${item.id} chapters: ${errorMessage(chapterError)}`)
          }
        }
      } else {
        const message = errorMessage(mangaAttempt.error)
        const blocked = isCloudflareError(mangaAttempt.error)
        document.manga = unavailableManga(item.mangaId, blocked ? 'BLOCKED' : 'ERROR', message)
        document.chapter = unavailableChapter(item.mangaId, mangaAttempt.error)
        console.log(`${item.id}: ${blocked ? 'blocked' : 'failed'} - ${message}`)

        if (item.expectedReachable) {
          requiredFailures.push(`${item.id}: ${message}`)
        }
      }

      fs.writeFileSync(
        path.join(metadataDirectory, `${item.id}.json`),
        `${JSON.stringify(document, null, 2)}\n`
      )
    }

    assert.deepEqual(requiredFailures, [])
  } finally {
    terminalPrompt?.close()
    terminalPrompt = undefined
    await closeBrowserSessions()
  }
}

async function withCloudflareRetry<T>(sourceName: string, targetUrl: string, operation: () => Promise<T>): Promise<{ value?: T, error?: unknown }> {
  try {
    return { value: await operation() }
  } catch (error) {
    if (!isCloudflareError(error) || !shouldPromptForCloudflare()) {
      return { error }
    }

    const validated = await requestCloudflareValidation(sourceName, targetUrl)
    if (!validated) return { error }

    try {
      return { value: await operation() }
    } catch (retryError) {
      return { error: retryError }
    }
  }
}

async function scheduleRequest(request: Request, interceptor: SourceInterceptor | undefined, timeout: number): Promise<Response> {
  const intercepted = interceptor?.interceptRequest
    ? await interceptor.interceptRequest(request)
    : request
  const session = browserSessions.get(new URL(intercepted.url).origin)
  const paperbackResponse = session
    ? await scheduleBrowserRequest(intercepted, session, timeout)
    : await scheduleFetchRequest(intercepted, timeout)

  return interceptor?.interceptResponse
    ? await interceptor.interceptResponse(paperbackResponse)
    : paperbackResponse
}

async function scheduleFetchRequest(request: Request, timeout: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: requestBody(request),
      redirect: 'follow',
      signal: controller.signal
    })
    return {
      data: await response.text(),
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      request
    }
  } finally {
    clearTimeout(timer)
  }
}

async function scheduleBrowserRequest(request: Request, session: BrowserSession, timeout: number): Promise<Response> {
  const headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) =>
    !/^(?:cookie|host|origin|referer|user-agent)$/i.test(name)))
  const result = await session.page.evaluate(async input => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), input.timeout)

    try {
      const response = await fetch(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body,
        credentials: 'include',
        redirect: 'follow',
        signal: controller.signal
      })

      return {
        data: await response.text(),
        status: response.status,
        headers: Object.fromEntries(response.headers.entries())
      }
    } finally {
      clearTimeout(timer)
    }
  }, {
    url: request.url,
    method: request.method,
    headers,
    body: requestBody(request),
    timeout
  })

  return {
    data: result.data,
    status: result.status,
    headers: result.headers,
    request
  }
}

async function requestCloudflareValidation(sourceName: string, targetUrl: string): Promise<boolean> {
  const origin = new URL(targetUrl).origin
  let session = browserSessions.get(origin)

  try {
    if (!session || session.page.isClosed()) {
      const browser = await launchBrowser()
      const context = browser.contexts()[0]
      if (!context) throw new Error('No Chrome context is available')
      session = { browser, page: await context.newPage() }
      browserSessions.set(origin, session)
    }

    const webdriverDetected = await session.page.evaluate(() => navigator.webdriver)
    if (webdriverDetected) {
      throw new Error('Chrome exposed navigator.webdriver; refusing an automation-detected Cloudflare session')
    }
    await session.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => undefined)
    await session.page.bringToFront()

    console.log(`\n${sourceName}: validation Cloudflare requise.`)
    console.log(`Page ouverte: ${targetUrl}`)
    console.log('Valide le challenge dans Chrome, puis reviens dans ce terminal.')

    terminalPrompt ??= createInterface({ input: process.stdin, output: process.stdout })
    const answer = await terminalPrompt.question('Appuie sur Entree pour reessayer, ou saisis s pour ignorer: ')

    if (answer.trim().toLowerCase() === 's') {
      await session.page.close()
      browserSessions.delete(origin)
      return false
    }

    return true
  } catch (error) {
    browserSessions.delete(origin)
    console.log(`${sourceName}: validation Cloudflare interrompue - ${errorMessage(error)}`)
    return false
  }
}

async function launchBrowser(): Promise<Browser> {
  if (browserHost?.browser.isConnected()) {
    return browserHost.browser
  }

  const executablePath = findBrowserExecutable()
  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'paperback-cloudflare-'))
  const debuggingPort = await findAvailablePort()
  const browserProcess = spawn(executablePath, [
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${profileDirectory}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ], {
    stdio: 'ignore',
    windowsHide: false
  })

  try {
    const endpoint = await waitForChromeEndpoint(debuggingPort, browserProcess)
    const browser = await chromium.connectOverCDP(endpoint)
    browserHost = { browser, process: browserProcess, profileDirectory }
    return browser
  } catch (error) {
    if (browserProcess.exitCode === null) browserProcess.kill()
    await removeBrowserProfile(profileDirectory)
    throw error
  }
}

function findBrowserExecutable(): string {
  const configured = process.env.PAPERBACK_BROWSER_PATH?.trim()
  if (configured) {
    if (!fs.existsSync(configured)) throw new Error(`Browser not found: ${configured}`)
    return configured
  }

  const candidates = process.platform === 'win32'
    ? [
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge']

  const executable = candidates.find((candidate): candidate is string => Boolean(candidate && fs.existsSync(candidate)))
  if (!executable) {
    throw new Error('Chrome or Edge was not found; set PAPERBACK_BROWSER_PATH')
  }

  return executable
}

async function waitForChromeEndpoint(port: number, browserProcess: ChildProcess): Promise<string> {
  const endpoint = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (browserProcess.exitCode !== null) {
      throw new Error(`Chrome exited with code ${browserProcess.exitCode}`)
    }

    try {
      const response = await fetch(`${endpoint}/json/version`)
      if (response.ok) return endpoint
    } catch {
      // Chrome has not opened the debugging endpoint yet.
    }

    await new Promise(resolve => setTimeout(resolve, 100))
  }

  throw new Error('Chrome debugging endpoint did not start')
}

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Could not reserve a Chrome debugging port'))
        return
      }

      server.close(error => error ? reject(error) : resolve(address.port))
    })
  })
}

async function closeBrowserSessions(): Promise<void> {
  browserSessions.clear()
  const host = browserHost
  browserHost = undefined
  if (!host) return

  await host.browser.close().catch(() => undefined)
  if (host.process.exitCode === null) host.process.kill()
  await removeBrowserProfile(host.profileDirectory)
}

async function removeBrowserProfile(profileDirectory: string): Promise<void> {
  const resolved = path.resolve(profileDirectory)
  const expectedPrefix = path.resolve(os.tmpdir(), 'paperback-cloudflare-')
  if (!resolved.startsWith(expectedPrefix)) return

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(resolved, { recursive: true, force: true })
      return
    } catch {
      // Chrome can keep profile files locked briefly while shutting down on Windows.
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
}

function shouldPromptForCloudflare(): boolean {
  const configured = process.env.PAPERBACK_CLOUDFLARE_INTERACTIVE?.trim()
  if (configured === '0' || configured?.toLowerCase() === 'false') return false
  if (configured === '1' || configured?.toLowerCase() === 'true') return true

  return ![
    process.env.CI,
    process.env.GITHUB_ACTIONS,
    process.env.GITLAB_CI,
    process.env.TF_BUILD,
    process.env.JENKINS_URL
  ].some(value => value && !/^(?:0|false)$/i.test(value))
}

function isCloudflareError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /cloudflare|cf-chl|http 403|challenge/i.test(message)
}

function requestBody(request: Request): string | undefined {
  if (request.method.toUpperCase() === 'GET' || request.data === undefined) {
    return undefined
  }
  if (typeof request.data === 'string') {
    return request.data
  }
  if (/application\/json/i.test(request.headers['content-type'] ?? '')) {
    return JSON.stringify(request.data)
  }
  return new URLSearchParams(request.data as Record<string, string>).toString()
}

function sourceDocument(item: MetadataCase): Record<string, unknown> {
  const info = item.info as unknown as Record<string, unknown>
  const fields = [
    'version', 'name', 'icon', 'author', 'description', 'contentRating', 'websiteBaseURL',
    'authorWebsite', 'language', 'sourceTags', 'intents'
  ]
  const document: Record<string, unknown> = { id: item.id }
  const missing: Record<string, string> = {}

  for (const field of fields) {
    const value = info[field]
    document[field] = value ?? null
    if (isMissing(value)) {
      missing[field] = 'NOT_FOUND: Paperback source metadata is not configured.'
    }
  }

  const intents = typeof info.intents === 'number' ? info.intents : 0
  document.intentNames = [
    [1, 'MANGA_CHAPTERS'], [2, 'MANGA_TRACKING'], [4, 'HOMEPAGE_SECTIONS'],
    [8, 'COLLECTION_MANAGEMENT'], [16, 'CLOUDFLARE_BYPASS_REQUIRED'], [32, 'SETTINGS_UI']
  ].filter(([value]) => (intents & Number(value)) !== 0).map(([, name]) => name)
  document._missing = missing
  document._contract = '@paperback/types SourceInfo, MangaInfo, Chapter and ChapterDetails 0.8.0-alpha.38'
  return document
}

function normalizeMangaInfo(info: MangaInfo): Record<string, unknown> {
  const input = info as unknown as Record<string, unknown>
  const metadata: Record<string, unknown> = {}
  const missing: Record<string, string> = {}

  for (const field of mangaInfoFields) {
    const value = input[field.key]
    metadata[field.key] = value ?? null
    if (isMissing(value)) {
      missing[field.key] = field.required
        ? 'NOT_FOUND: required MangaInfo metadata was not returned by the source.'
        : 'NOT_FOUND: optional MangaInfo metadata is not exposed by the source.'
    }
  }

  metadata._missing = missing
  return metadata
}

function normalizeChapter(chapter: Chapter): Record<string, unknown> {
  const input = chapter as unknown as Record<string, unknown>
  const metadata: Record<string, unknown> = {}
  const missing: Record<string, string> = {}

  for (const field of chapterFields) {
    const value = input[field.key]
    metadata[field.key] = value instanceof Date ? value.toISOString() : value ?? null
    if (isMissing(value)) {
      missing[field.key] = 'NOT_FOUND: required Chapter metadata was not returned by the source.'
    }
  }

  metadata._missing = missing
  return metadata
}

function availableChapterDetails(details: ChapterDetails): Record<string, unknown> {
  const input = details as unknown as Record<string, unknown>
  const metadata: Record<string, unknown> = {}
  const missing: Record<string, string> = {}

  for (const field of chapterDetailsFields) {
    const value = input[field.key]
    metadata[field.key] = value ?? null
    if (isMissing(value)) {
      missing[field.key] = 'NOT_FOUND: required ChapterDetails metadata was not returned by the source.'
    }
  }

  metadata._missing = missing
  return {
    fetchStatus: 'FOUND',
    fetchedAt: new Date().toISOString(),
    metadata,
    error: null
  }
}

function unavailableManga(mangaId: string, status: 'BLOCKED' | 'ERROR', error: string): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}
  const missing: Record<string, string> = {}
  for (const field of mangaInfoFields) {
    metadata[field.key] = null
    missing[field.key] = `NOT_FOUND: live request ${status.toLowerCase()}.`
  }
  metadata._missing = missing

  return {
    fetchStatus: status,
    mangaId,
    shareUrl: null,
    fetchedAt: new Date().toISOString(),
    metadata,
    error
  }
}

function unavailableChapter(mangaId: string, error: unknown): Record<string, unknown> {
  const blocked = isCloudflareError(error)
  const status = blocked ? 'BLOCKED' : 'ERROR'
  const metadata: Record<string, unknown> = {}
  const missing: Record<string, string> = {}

  for (const field of chapterFields) {
    metadata[field.key] = null
    missing[field.key] = `NOT_FOUND: live chapter request ${status.toLowerCase()}.`
  }
  metadata._missing = missing

  return {
    fetchStatus: status,
    mangaId,
    chapterCount: null,
    fetchedAt: new Date().toISOString(),
    metadata,
    details: unavailableChapterDetails(null, error),
    error: errorMessage(error)
  }
}

function unavailableChapterDetails(chapterId: string | null, error: unknown): Record<string, unknown> {
  const blocked = isCloudflareError(error)
  const status = blocked ? 'BLOCKED' : 'ERROR'
  const metadata: Record<string, unknown> = {}
  const missing: Record<string, string> = {}

  for (const field of chapterDetailsFields) {
    metadata[field.key] = field.key === 'id' ? chapterId : null
    if (metadata[field.key] === null) {
      missing[field.key] = `NOT_FOUND: live chapter details request ${status.toLowerCase()}.`
    }
  }
  metadata._missing = missing

  return {
    fetchStatus: status,
    fetchedAt: new Date().toISOString(),
    metadata,
    error: errorMessage(error)
  }
}

function selectLatestChapter(chapters: Chapter[]): Chapter | undefined {
  return chapters.slice().sort((left, right) => chapterOrder(right) - chapterOrder(left))[0]
}

function chapterOrder(chapter: Chapter): number {
  if (Number.isFinite(chapter.sortingIndex)) return chapter.sortingIndex
  return Number.isFinite(chapter.chapNum) ? chapter.chapNum : 0
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error === undefined || error === null) return 'Unknown error'
  return String(error)
}

function isMissing(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string' && /^(?:|unknown|inconnu|n\/a|-)$/i.test(value.trim())) return true
  if (Array.isArray(value)) return value.length === 0
  return false
}
