import { z } from "zod"

export type LocalSecuritySettings = {
  readonly allowedHosts: readonly string[]
  readonly requestBytes: number
  readonly fileBytes: number
  readonly pdfPages: number
  readonly docxEntries: number
  readonly docxUncompressedBytes: number
  readonly extractionTimeoutMilliseconds: number
  readonly fetchRedirects: number
  readonly fetchBytes: number
  readonly fetchTimeoutMilliseconds: number
}

export class LocalSecurityConfigurationError extends Error {
  override readonly name = "LocalSecurityConfigurationError"

  constructor() {
    super("LOCAL_SECURITY_CONFIGURATION_ERROR")
  }
}

const PositiveIntegerSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]*$/)
  .transform(Number)
  .pipe(z.number().int().positive())

const SecurityEnvironmentSchema = z.object({
  LOCAL_HOSTS: z.string().trim().optional(),
  REQUEST_MAX_BYTES: PositiveIntegerSchema.default(5_242_880),
  FILE_MAX_BYTES: PositiveIntegerSchema.default(4_194_304),
  PDF_MAX_PAGES: PositiveIntegerSchema.default(40),
  DOCX_MAX_ENTRIES: PositiveIntegerSchema.default(128),
  DOCX_MAX_UNCOMPRESSED_BYTES: PositiveIntegerSchema.default(8_388_608),
  EXTRACTION_TIMEOUT_MS: PositiveIntegerSchema.default(5_000),
  FETCH_MAX_REDIRECTS: PositiveIntegerSchema.default(3),
  FETCH_MAX_BYTES: PositiveIntegerSchema.default(524_288),
  FETCH_TIMEOUT_MS: PositiveIntegerSchema.default(5_000)
})

const LocalHostSchema = /^(localhost|127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}$/

const defaultHosts = (port: number): readonly string[] => [
  `localhost:${port}`,
  `127.0.0.1:${port}`,
  `[::1]:${port}`
]

const parseHosts = (configuredHosts: string | undefined, port: number): readonly string[] => {
  const hosts = configuredHosts === undefined ? defaultHosts(port) : configuredHosts.split(",")
  const normalizedHosts = hosts.map((host) => host.trim().toLowerCase())
  if (
    normalizedHosts.length === 0 ||
    normalizedHosts.some((host) => !LocalHostSchema.test(host)) ||
    new Set(normalizedHosts).size !== normalizedHosts.length
  )
    throw new LocalSecurityConfigurationError()
  return normalizedHosts
}

export const parseLocalSecuritySettings = (
  environment: Readonly<Record<string, string | undefined>>,
  port: number
): LocalSecuritySettings => {
  const parsed = SecurityEnvironmentSchema.safeParse(environment)
  if (!parsed.success || parsed.data.FILE_MAX_BYTES > parsed.data.REQUEST_MAX_BYTES)
    throw new LocalSecurityConfigurationError()

  return {
    allowedHosts: parseHosts(parsed.data.LOCAL_HOSTS, port),
    requestBytes: parsed.data.REQUEST_MAX_BYTES,
    fileBytes: parsed.data.FILE_MAX_BYTES,
    pdfPages: parsed.data.PDF_MAX_PAGES,
    docxEntries: parsed.data.DOCX_MAX_ENTRIES,
    docxUncompressedBytes: parsed.data.DOCX_MAX_UNCOMPRESSED_BYTES,
    extractionTimeoutMilliseconds: parsed.data.EXTRACTION_TIMEOUT_MS,
    fetchRedirects: parsed.data.FETCH_MAX_REDIRECTS,
    fetchBytes: parsed.data.FETCH_MAX_BYTES,
    fetchTimeoutMilliseconds: parsed.data.FETCH_TIMEOUT_MS
  }
}

export const defaultLocalSecuritySettings = (): LocalSecuritySettings =>
  parseLocalSecuritySettings({}, 3000)
