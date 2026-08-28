export const IngestionErrorCode = {
  BinaryText: "BINARY_TEXT",
  DocxEntriesLimit: "DOCX_ENTRIES_LIMIT",
  DocxInvalid: "DOCX_INVALID",
  DocxUncompressedLimit: "DOCX_UNCOMPRESSED_LIMIT",
  EmptyText: "EMPTY_TEXT",
  ExtractionFailed: "EXTRACTION_FAILED",
  FileTooLarge: "FILE_TOO_LARGE",
  MagicMismatch: "MAGIC_MISMATCH",
  MimeNotAllowed: "MIME_NOT_ALLOWED",
  OcrUnsupported: "OCR_UNSUPPORTED",
  PdfPageLimit: "PDF_PAGE_LIMIT",
  PolyglotFile: "POLYGLOT_FILE",
  ZipPathInvalid: "ZIP_PATH_INVALID"
} as const

export type IngestionErrorCode = (typeof IngestionErrorCode)[keyof typeof IngestionErrorCode]

export class IngestionError extends Error {
  override readonly name = "IngestionError"

  constructor(readonly code: IngestionErrorCode) {
    super(code)
  }
}
