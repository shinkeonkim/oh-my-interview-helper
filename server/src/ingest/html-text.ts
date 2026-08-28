const Entity = /&(amp|apos|gt|lt|nbsp|quot);|&#(x[0-9a-f]+|[0-9]+);/gi
const IgnoredElements =
  /<(?:iframe|noscript|object|script|style|svg|template)\b[^>]*>[\s\S]*?<\/(?:iframe|noscript|object|script|style|svg|template)\s*>/gi

const decodeEntity = (
  value: string,
  named: string | undefined,
  numeric: string | undefined
): string => {
  if (named !== undefined)
    return (
      { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' }[named.toLowerCase()] ?? ""
    )
  if (numeric === undefined) return value
  const radix = numeric.startsWith("x") ? 16 : 10
  const codePoint = Number.parseInt(numeric.slice(radix === 16 ? 1 : 0), radix)
  return codePoint >= 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
    ? String.fromCodePoint(codePoint)
    : ""
}

export const htmlToPlainText = (source: string, maximumCharacters: number): string =>
  source
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(IgnoredElements, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(Entity, decodeEntity)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumCharacters)
