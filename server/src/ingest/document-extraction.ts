import { unzipSync } from "fflate"
import { extractText, getDocumentProxy } from "unpdf"

import type { LocalSecuritySettings } from "../security/config"
import { IngestionError, IngestionErrorCode } from "./errors"

export const DocumentFormat = {
  Docx: "docx",
  Markdown: "markdown",
  Pdf: "pdf",
  Text: "text"
} as const

export type DocumentFormat = (typeof DocumentFormat)[keyof typeof DocumentFormat]

export type ExtractedDocument = {
  readonly format: DocumentFormat
  readonly pageCount?: number
  readonly text: string
}

type ZipEntry = {
  readonly name: string
  readonly uncompressedBytes: number
}

const ZipEndSignature = 0x06054b50
const ZipCentralSignature = 0x02014b50
const ZipEndMinimumSize = 22
const UnixSymlinkMask = 0o170000
const UnixSymlinkType = 0o120000

const normaliseText = (text: string): string => {
  const normalised = text
    .replace(/^\ufeff/, "")
    .replace(/\r\n?/g, "\n")
    .trim()
  if (normalised.length === 0) throw new IngestionError(IngestionErrorCode.EmptyText)
  return normalised
}

const decodeUtf8Text = (bytes: Uint8Array, binaryCode: IngestionErrorCode): string => {
  if (bytes.includes(0)) throw new IngestionError(binaryCode)
  try {
    return normaliseText(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch (error) {
    if (error instanceof IngestionError) throw error
    throw new IngestionError(binaryCode)
  }
}

const inRange = (bytes: Uint8Array, offset: number, size: number): boolean =>
  Number.isSafeInteger(offset) &&
  Number.isSafeInteger(size) &&
  offset >= 0 &&
  size >= 0 &&
  offset + size <= bytes.length

const findZipEnd = (bytes: Uint8Array): number => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const firstOffset = Math.max(0, bytes.length - 65_557)
  for (let offset = bytes.length - ZipEndMinimumSize; offset >= firstOffset; offset -= 1) {
    if (view.getUint32(offset, true) === ZipEndSignature) return offset
  }
  throw new IngestionError(IngestionErrorCode.ExtractionFailed)
}

const zipPathIsSafe = (name: string): boolean => {
  const normalized = name.replace(/\\/g, "/")
  return (
    normalized.length > 0 &&
    !normalized.startsWith("/") &&
    !/^[a-z]:\//i.test(normalized) &&
    !Array.from(normalized).some((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint !== undefined && (codePoint < 32 || codePoint === 127)
    }) &&
    normalized.split("/").every((segment) => segment !== "..")
  )
}

const readZipEntries = (bytes: Uint8Array, limits: LocalSecuritySettings): readonly ZipEntry[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = findZipEnd(bytes)
  if (!inRange(bytes, end, ZipEndMinimumSize))
    throw new IngestionError(IngestionErrorCode.ExtractionFailed)
  const entryCount = view.getUint16(end + 10, true)
  const centralDirectoryOffset = view.getUint32(end + 16, true)
  if (entryCount === 0xffff || centralDirectoryOffset === 0xffffffff)
    throw new IngestionError(IngestionErrorCode.ExtractionFailed)
  if (entryCount > limits.docxEntries) throw new IngestionError(IngestionErrorCode.DocxEntriesLimit)

  const decoder = new TextDecoder("utf-8", { fatal: true })
  const entries: ZipEntry[] = []
  const names = new Set<string>()
  let offset = centralDirectoryOffset
  let totalUncompressedBytes = 0
  for (let index = 0; index < entryCount; index += 1) {
    if (!inRange(bytes, offset, 46) || view.getUint32(offset, true) !== ZipCentralSignature)
      throw new IngestionError(IngestionErrorCode.ExtractionFailed)
    const versionMadeBy = view.getUint16(offset + 4, true)
    const uncompressedBytes = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const externalAttributes = view.getUint32(offset + 38, true)
    const recordSize = 46 + nameLength + extraLength + commentLength
    if (!inRange(bytes, offset, recordSize))
      throw new IngestionError(IngestionErrorCode.ExtractionFailed)
    let name: string
    try {
      name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    } catch {
      throw new IngestionError(IngestionErrorCode.ZipPathInvalid)
    }
    const unixMode = externalAttributes >>> 16
    const normalizedName = name.replace(/\\/g, "/")
    if (
      !zipPathIsSafe(name) ||
      (versionMadeBy >>> 8 === 3 && (unixMode & UnixSymlinkMask) === UnixSymlinkType)
    )
      throw new IngestionError(IngestionErrorCode.ZipPathInvalid)
    if (names.has(normalizedName)) throw new IngestionError(IngestionErrorCode.DocxInvalid)
    names.add(normalizedName)
    totalUncompressedBytes += uncompressedBytes
    if (totalUncompressedBytes > limits.docxUncompressedBytes)
      throw new IngestionError(IngestionErrorCode.DocxUncompressedLimit)
    entries.push({ name, uncompressedBytes })
    offset += recordSize
  }
  return entries
}

const extractDocx = (bytes: Uint8Array, limits: LocalSecuritySettings): ExtractedDocument => {
  try {
    const entries = readZipEntries(bytes, limits)
    if (!entries.some((entry) => entry.name === "word/document.xml"))
      throw new IngestionError(IngestionErrorCode.ExtractionFailed)
    const archive = unzipSync(bytes, {
      filter: (entry) => entry.name === "word/document.xml" || entry.name === "[Content_Types].xml"
    })
    const document = archive["word/document.xml"]
    if (document === undefined) throw new IngestionError(IngestionErrorCode.ExtractionFailed)
    const xml = decodeUtf8Text(document, IngestionErrorCode.ExtractionFailed)
    const words = Array.from(
      xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gi),
      (match) => match[1] ?? ""
    )
    return { format: DocumentFormat.Docx, text: normaliseText(words.join(" ")) }
  } catch (error) {
    if (error instanceof IngestionError) throw error
    throw new IngestionError(IngestionErrorCode.ExtractionFailed)
  }
}

const withTimeout = async <Value>(
  operation: Promise<Value>,
  milliseconds: number
): Promise<Value> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new IngestionError(IngestionErrorCode.ExtractionFailed)),
      milliseconds
    )
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

const extractPdf = async (
  bytes: Uint8Array,
  limits: LocalSecuritySettings
): Promise<ExtractedDocument> => {
  try {
    const document = await withTimeout(
      getDocumentProxy(bytes, { maxImageSize: 16_777_216, stopAtErrors: true, verbosity: 0 }),
      limits.extractionTimeoutMilliseconds
    )
    if (document.numPages > limits.pdfPages)
      throw new IngestionError(IngestionErrorCode.PdfPageLimit)
    const result = await withTimeout(
      extractText(document, { mergePages: true }),
      limits.extractionTimeoutMilliseconds
    )
    const text = result.text
      .replace(/^\ufeff/, "")
      .replace(/\r\n?/g, "\n")
      .trim()
    if (text.length === 0 || !/[\p{L}\p{N}]/u.test(text))
      throw new IngestionError(IngestionErrorCode.OcrUnsupported)
    return { format: DocumentFormat.Pdf, pageCount: result.totalPages, text }
  } catch (error) {
    if (error instanceof IngestionError) throw error
    throw new IngestionError(IngestionErrorCode.ExtractionFailed)
  }
}

export const extractDocument = async (
  format: DocumentFormat,
  bytes: Uint8Array,
  limits: LocalSecuritySettings
): Promise<ExtractedDocument> => {
  switch (format) {
    case DocumentFormat.Docx:
      return extractDocx(bytes, limits)
    case DocumentFormat.Markdown:
    case DocumentFormat.Text:
      return { format, text: decodeUtf8Text(bytes, IngestionErrorCode.BinaryText) }
    case DocumentFormat.Pdf:
      return extractPdf(bytes, limits)
  }
}
