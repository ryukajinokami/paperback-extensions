export function createReaderError(source: string, mangaId: string, chapterId: string, html: string): Error {
  const normalized = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()

  let reason = 'the site reader format may have changed'

  if (/access denied|just a moment|cf-chl|cloudflare/.test(normalized)) {
    reason = 'the site blocked the reader request'
  } else if (/404|page not found|could not be found|introuvable/.test(normalized)) {
    reason = 'the chapter page was not found'
  } else if (/premium|subscribe|subscriber|locked|acc[eè]s restreint|abonner|gratuit le/.test(normalized)) {
    reason = 'the chapter is premium or not public yet'
  } else if (html.trim().length === 0) {
    reason = 'the site returned an empty chapter page'
  }

  return new Error(`[${source}] No readable pages for ${mangaId}/${chapterId}: ${reason}`)
}
