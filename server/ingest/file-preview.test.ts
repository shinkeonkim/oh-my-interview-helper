import { afterEach, describe, expect, test } from "bun:test"
import { zipSync } from "fflate"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { defaultLocalSecuritySettings } from "../src/security/config"
import { previewFile, type IngestionError } from "../src/ingest/file-preview"

const directories: string[] = []
const textEncoder = new TextEncoder()

const dataDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-ingest-"))
  directories.push(directory)
  return directory
}

const makePdf = (text: string, pageCount = 1): Uint8Array => {
  const pages = Array.from({ length: pageCount }, (_, index) => `${4 + index * 2} 0 R`)
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.join(" ")}] /Count ${pageCount} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ]
  for (let page = 0; page < pageCount; page += 1) {
    const pageObject = 4 + page * 2
    const contentObject = pageObject + 1
    const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
    objects.push(
      `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /MediaBox [0 0 612 792] /Contents ${contentObject} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
    )
  }
  let source = "%PDF-1.4\n"
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(source.length)
    source += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = source.length
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  source += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return textEncoder.encode(source)
}

const makeDocx = (entries: Readonly<Record<string, Uint8Array>>): Uint8Array =>
  zipSync(entries, { level: 0 })

const docx = (documentXml: string): Uint8Array =>
  makeDocx({
    "[Content_Types].xml": textEncoder.encode("<Types />"),
    "word/document.xml": textEncoder.encode(documentXml)
  })

const limits = (overrides: Partial<ReturnType<typeof defaultLocalSecuritySettings>>) => ({
  ...defaultLocalSecuritySettings(),
  ...overrides
})

const uploaded = (content: BlobPart, filename: string, type: string): File =>
  new File([content], filename, { type })

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe("safe local file preview", () => {
  test("extracts UTF-8 text and Markdown after removing a BOM without preserving a user path", async () => {
    // Given
    const directory = dataDirectory()
    const file = uploaded("\ufeff# Resume\nBuilt safe systems.", "../../resume.md", "text/markdown")

    // When
    const preview = await previewFile({ dataDirectory: directory, file, limits: limits({}) })

    // Then
    expect(preview).toMatchObject({
      displayName: "resume.md",
      format: "markdown",
      text: "# Resume\nBuilt safe systems."
    })
    expect(preview.storageId).toMatch(/^[0-9a-f-]{36}$/)
    expect(preview.text).not.toContain("../../")
  })

  test("rejects binary, oversized, MIME-mismatched, and polyglot uploads with typed errors", async () => {
    // Given
    const directory = dataDirectory()
    const inputs = [
      uploaded(new Uint8Array([0x61, 0x00, 0x62]), "resume.txt", "text/plain"),
      uploaded("much too large", "resume.txt", "text/plain"),
      uploaded("not a pdf", "resume.pdf", "application/pdf"),
      uploaded(
        new Uint8Array([...makePdf("valid"), 0x50, 0x4b, 0x03, 0x04]),
        "resume.pdf",
        "application/pdf"
      )
    ]
    const expectedCodes = ["BINARY_TEXT", "FILE_TOO_LARGE", "MAGIC_MISMATCH", "POLYGLOT_FILE"]

    // When / Then
    for (const [index, file] of inputs.entries()) {
      const inputLimits = index === 1 ? limits({ fileBytes: 5 }) : limits({})
      await expect(
        previewFile({ dataDirectory: directory, file, limits: inputLimits })
      ).rejects.toMatchObject({ code: expectedCodes[index] } satisfies Partial<IngestionError>)
    }
  })

  test("extracts text PDFs and rejects scanned, corrupt, and page-limit PDFs without OCR", async () => {
    // Given
    const directory = dataDirectory()
    const textPdf = uploaded(makePdf("Interview evidence"), "resume.pdf", "application/pdf")
    const scannedPdf = uploaded(makePdf(""), "scan.pdf", "application/pdf")
    const corruptPdf = uploaded("%PDF-corrupt", "bad.pdf", "application/pdf")
    const manyPages = uploaded(makePdf("two pages", 2), "many.pdf", "application/pdf")

    // When
    const preview = await previewFile({
      dataDirectory: directory,
      file: textPdf,
      limits: limits({})
    })

    // Then
    expect(preview).toMatchObject({ format: "pdf", pageCount: 1, text: "Interview evidence" })
    await expect(
      previewFile({ dataDirectory: directory, file: scannedPdf, limits: limits({}) })
    ).rejects.toMatchObject({ code: "OCR_UNSUPPORTED" } satisfies Partial<IngestionError>)
    await expect(
      previewFile({ dataDirectory: directory, file: corruptPdf, limits: limits({}) })
    ).rejects.toMatchObject({ code: "EXTRACTION_FAILED" } satisfies Partial<IngestionError>)
    await expect(
      previewFile({ dataDirectory: directory, file: manyPages, limits: limits({ pdfPages: 1 }) })
    ).rejects.toMatchObject({ code: "PDF_PAGE_LIMIT" } satisfies Partial<IngestionError>)
  })

  test("extracts DOCX text while rejecting traversal, oversized entries, and decompression bombs", async () => {
    // Given
    const directory = dataDirectory()
    const valid = uploaded(
      docx(
        "<w:document><w:body><w:p><w:r><w:t>Document resume</w:t></w:r></w:p></w:body></w:document>"
      ),
      "resume.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    const traversal = uploaded(
      makeDocx({ "../word/document.xml": textEncoder.encode("bad") }),
      "traversal.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    const bomb = uploaded(
      docx(`<w:document><w:t>${"a".repeat(100)}</w:t></w:document>`),
      "bomb.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    const manyEntries = uploaded(
      makeDocx(
        Object.fromEntries(
          Array.from({ length: 3 }, (_, index) => [
            `word/entry-${index}.xml`,
            textEncoder.encode("entry")
          ])
        )
      ),
      "entries.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )

    // When
    const preview = await previewFile({ dataDirectory: directory, file: valid, limits: limits({}) })

    // Then
    expect(preview).toMatchObject({ format: "docx", text: "Document resume" })
    await expect(
      previewFile({ dataDirectory: directory, file: traversal, limits: limits({}) })
    ).rejects.toMatchObject({ code: "ZIP_PATH_INVALID" } satisfies Partial<IngestionError>)
    await expect(
      previewFile({
        dataDirectory: directory,
        file: bomb,
        limits: limits({ docxUncompressedBytes: 50 })
      })
    ).rejects.toMatchObject({ code: "DOCX_UNCOMPRESSED_LIMIT" } satisfies Partial<IngestionError>)
    await expect(
      previewFile({
        dataDirectory: directory,
        file: manyEntries,
        limits: limits({ docxEntries: 2 })
      })
    ).rejects.toMatchObject({ code: "DOCX_ENTRIES_LIMIT" } satisfies Partial<IngestionError>)
  })

  test("removes every generated temporary upload after an extraction failure", async () => {
    // Given
    const directory = dataDirectory()
    const corruptPdf = uploaded("%PDF-corrupt", "bad.pdf", "application/pdf")

    // When
    await expect(
      previewFile({ dataDirectory: directory, file: corruptPdf, limits: limits({}) })
    ).rejects.toMatchObject({ code: "EXTRACTION_FAILED" } satisfies Partial<IngestionError>)

    // Then
    expect(readdirSync(join(directory, "preview-uploads"))).toEqual([])
  })
})
