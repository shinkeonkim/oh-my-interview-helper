import { randomUUID } from "node:crypto"
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises"
import { basename, relative, resolve } from "node:path"

import type { LocalSecuritySettings } from "../security/config"
import { DocumentFormat, extractDocument, type ExtractedDocument } from "./document-extraction"
import { IngestionError, IngestionErrorCode } from "./errors"

export { IngestionError } from "./errors"

export type FilePreview = ExtractedDocument & {
  readonly displayName: string
  readonly storageId: string
}

export type FilePreviewInput = {
  readonly dataDirectory: string
  readonly file: File
  readonly limits: LocalSecuritySettings
}

const PdfMagic = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])
const ZipMagic = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
const DocxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

const startsWith = (bytes: Uint8Array, expected: Uint8Array): boolean =>
  bytes.length >= expected.length && expected.every((value, index) => bytes[index] === value)

const contains = (bytes: Uint8Array, expected: Uint8Array): boolean => {
  for (let offset = 0; offset <= bytes.length - expected.length; offset += 1) {
    if (expected.every((value, index) => bytes[offset + index] === value)) return true
  }
  return false
}

const displayName = (name: string): string => {
  const sanitized = basename(name.replace(/\\/g, "/"))
    .split("")
    .filter((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint === undefined || (codePoint >= 32 && codePoint !== 127)
    })
    .join("")
    .trim()
  return (sanitized || "upload").slice(0, 120)
}

const formatFor = (file: File, bytes: Uint8Array): DocumentFormat => {
  const name = displayName(file.name).toLowerCase()
  const mime = file.type.toLowerCase().split(";", 1)[0] ?? ""
  if (name.endsWith(".pdf")) {
    if (mime !== "application/pdf") throw new IngestionError(IngestionErrorCode.MimeNotAllowed)
    if (!startsWith(bytes, PdfMagic)) throw new IngestionError(IngestionErrorCode.MagicMismatch)
    if (contains(bytes.subarray(PdfMagic.length), ZipMagic))
      throw new IngestionError(IngestionErrorCode.PolyglotFile)
    return DocumentFormat.Pdf
  }
  if (name.endsWith(".docx")) {
    if (mime !== DocxMime) throw new IngestionError(IngestionErrorCode.MimeNotAllowed)
    if (!startsWith(bytes, ZipMagic)) throw new IngestionError(IngestionErrorCode.MagicMismatch)
    if (contains(bytes, PdfMagic)) throw new IngestionError(IngestionErrorCode.PolyglotFile)
    return DocumentFormat.Docx
  }
  if (name.endsWith(".md") && ["text/markdown", "text/x-markdown"].includes(mime)) {
    if (startsWith(bytes, PdfMagic) || startsWith(bytes, ZipMagic))
      throw new IngestionError(IngestionErrorCode.BinaryText)
    return DocumentFormat.Markdown
  }
  if (name.endsWith(".txt") && mime === "text/plain") {
    if (startsWith(bytes, PdfMagic) || startsWith(bytes, ZipMagic))
      throw new IngestionError(IngestionErrorCode.BinaryText)
    return DocumentFormat.Text
  }
  throw new IngestionError(IngestionErrorCode.MimeNotAllowed)
}

const assertContained = (directory: string, path: string): string => {
  const pathFromDirectory = relative(directory, path)
  if (
    pathFromDirectory === "" ||
    pathFromDirectory.startsWith("..") ||
    pathFromDirectory.includes("../")
  )
    throw new IngestionError(IngestionErrorCode.ExtractionFailed)
  return path
}

const createStage = async (
  dataDirectory: string,
  bytes: Uint8Array
): Promise<{ readonly cleanup: () => Promise<void>; readonly storageId: string }> => {
  const directory = resolve(dataDirectory, "preview-uploads")
  await mkdir(directory, { mode: 0o700, recursive: true })
  const information = await lstat(directory)
  if (!information.isDirectory() || information.isSymbolicLink())
    throw new IngestionError(IngestionErrorCode.ExtractionFailed)
  const storageId = randomUUID()
  const temporaryPath = assertContained(directory, resolve(directory, `.tmp-${storageId}`))
  const finalPath = assertContained(directory, resolve(directory, storageId))
  await writeFile(temporaryPath, bytes, { flag: "wx", mode: 0o600 })
  await rename(temporaryPath, finalPath)
  return {
    cleanup: async () => {
      await rm(finalPath, { force: true })
      await rm(temporaryPath, { force: true })
    },
    storageId
  }
}

export const previewFile = async ({
  dataDirectory,
  file,
  limits
}: FilePreviewInput): Promise<FilePreview> => {
  if (file.size === 0 || file.size > limits.fileBytes)
    throw new IngestionError(IngestionErrorCode.FileTooLarge)
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > limits.fileBytes)
    throw new IngestionError(IngestionErrorCode.FileTooLarge)
  const format = formatFor(file, bytes)
  const stage = await createStage(dataDirectory, bytes)
  try {
    const extracted = await extractDocument(format, bytes, limits)
    return { ...extracted, displayName: displayName(file.name), storageId: stage.storageId }
  } finally {
    await stage.cleanup()
  }
}
