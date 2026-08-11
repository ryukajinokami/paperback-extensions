export function parseDateOrUndefined(value: string | undefined): Date | undefined {
  const trimmed = value?.trim()
  if (!trimmed) {
    return undefined
  }

  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

const FRENCH_MONTHS: Record<string, number> = {
  janvier: 0,
  fevrier: 1,
  mars: 2,
  avril: 3,
  mai: 4,
  juin: 5,
  juillet: 6,
  aout: 7,
  septembre: 8,
  octobre: 9,
  novembre: 10,
  decembre: 11
}

export function parseFrenchDateOrUndefined(value: string | undefined): Date | undefined {
  const trimmed = value?.trim()
  if (!trimmed) {
    return undefined
  }

  const numeric = /(?:^|\D)(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})(?:\D|$)/.exec(trimmed)
  if (numeric?.[1] && numeric[2] && numeric[3]) {
    const year = numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3])
    return validLocalDate(year, Number(numeric[2]) - 1, Number(numeric[1]))
  }

  const normalized = trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  const textual = /(?:^|\D)(\d{1,2})(?:er)?\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+(\d{4})(?:\D|$)/.exec(normalized)
  if (textual?.[1] && textual[2] && textual[3]) {
    const month = FRENCH_MONTHS[textual[2]]
    if (month !== undefined) {
      return validLocalDate(Number(textual[3]), month, Number(textual[1]))
    }
  }

  return parseDateOrUndefined(trimmed)
}

function validLocalDate(year: number, month: number, day: number): Date | undefined {
  const parsed = new Date(year, month, day)
  return parsed.getFullYear() === year && parsed.getMonth() === month && parsed.getDate() === day
    ? parsed
    : undefined
}
