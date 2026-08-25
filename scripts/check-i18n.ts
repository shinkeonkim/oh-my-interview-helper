import { en } from "../client/src/locales/en"
import { ko } from "../client/src/locales/ko"

type FlatCatalog = Readonly<Record<string, string>>

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null

const flattenCatalog = (value: unknown, prefix = ""): FlatCatalog => {
  if (!isRecord(value)) return { [prefix]: String(value) }

  const entries = Object.entries(value).flatMap(([key, child]) => {
    const nextPrefix = prefix.length > 0 ? `${prefix}.${key}` : key
    return Object.entries(flattenCatalog(child, nextPrefix))
  })

  return Object.fromEntries(entries)
}

const koreanKeys = new Set(Object.keys(flattenCatalog(ko)))
const englishKeys = new Set(Object.keys(flattenCatalog(en)))
const missingInEnglish = [...koreanKeys].filter((key) => !englishKeys.has(key))
const missingInKorean = [...englishKeys].filter((key) => !koreanKeys.has(key))

const fixtureIndex = Bun.argv.indexOf("--fixture")
const fixturePath = fixtureIndex >= 0 ? Bun.argv[fixtureIndex + 1] : undefined
if (fixturePath) {
  const fixtureText = await Bun.file(fixturePath).text()
  const fixture = flattenCatalog(JSON.parse(fixtureText))
  for (const key of koreanKeys) {
    if (!Object.hasOwn(fixture, key)) missingInEnglish.push(key)
  }
}

if (missingInEnglish.length > 0 || missingInKorean.length > 0) {
  console.error("i18n parity check failed")
  if (missingInEnglish.length > 0) console.error(`Missing in en: ${missingInEnglish.join(", ")}`)
  if (missingInKorean.length > 0) console.error(`Missing in ko: ${missingInKorean.join(", ")}`)
  process.exitCode = 1
} else {
  console.info(`i18n parity ok: ${koreanKeys.size} keys`)
}
