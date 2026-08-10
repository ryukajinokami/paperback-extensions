export interface NormalizeUrlOptions {
  allowDataUrl?: boolean
  unwrapNextImage?: boolean
}

export function normalizeHttpUrl(value: string, baseUrl: string, options: NormalizeUrlOptions = {}): string {
  let cleaned = value.trim().replace(/\\\//g, '/')

  if (cleaned.length === 0) {
    return ''
  }

  if (cleaned.startsWith('data:')) {
    return options.allowDataUrl ? cleaned : ''
  }

  if (options.unwrapNextImage !== false) {
    const proxied = /\/_next\/image\?url=([^&]+)/.exec(cleaned)
    if (proxied?.[1]) {
      return normalizeHttpUrl(safeDecodeURIComponent(proxied[1]), baseUrl, options)
    }
  }

  if (cleaned.startsWith('//')) {
    cleaned = `https:${cleaned}`
  } else if (cleaned.startsWith('/')) {
    cleaned = `${baseUrl}${cleaned}`
  }

  return encodeURI(cleaned)
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
