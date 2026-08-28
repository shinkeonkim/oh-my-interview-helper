import { afterEach, expect, test } from "bun:test"
import { Zip, ZipPassThrough } from "fflate"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { previewFile, type IngestionError } from "../src/ingest/file-preview"
import { defaultLocalSecuritySettings } from "../src/security/config"

type ZipEntry = { readonly content: string; readonly name: string }

const directories: string[] = []
const textEncoder = new TextEncoder()
const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
const documentXml = "<w:document><w:t>accepted only without duplicate validation</w:t></w:document>"

const dataDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-docx-duplicates-"))
  directories.push(directory)
  return directory
}

const duplicateDocx = (entries: readonly ZipEntry[]): Uint8Array => {
  const chunks: Uint8Array[] = []
  const archive = new Zip((error, chunk) => {
    if (error !== null) throw error
    chunks.push(chunk)
  })

  for (const entry of entries) {
    const file = new ZipPassThrough(entry.name)
    archive.add(file)
    file.push(textEncoder.encode(entry.content), true)
  }
  archive.end()

  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

const fixtures: readonly { readonly entries: readonly ZipEntry[]; readonly name: string }[] = [
  {
    name: "duplicate word/document.xml",
    entries: [
      { name: "[Content_Types].xml", content: "<Types />" },
      { name: "word/document.xml", content: documentXml },
      { name: "word/document.xml", content: "<w:document><w:t>ambiguous</w:t></w:document>" }
    ]
  },
  {
    name: "duplicate [Content_Types].xml",
    entries: [
      { name: "[Content_Types].xml", content: "<Types />" },
      { name: "[Content_Types].xml", content: "<Types><Override /></Types>" },
      { name: "word/document.xml", content: documentXml }
    ]
  },
  {
    name: "duplicate word/_rels/document.xml.rels",
    entries: [
      { name: "[Content_Types].xml", content: "<Types />" },
      { name: "word/document.xml", content: documentXml },
      { name: "word/_rels/document.xml.rels", content: "<Relationships />" },
      {
        name: "word/_rels/document.xml.rels",
        content: "<Relationships><Relationship /></Relationships>"
      }
    ]
  },
  {
    name: "slash and backslash normalized collision",
    entries: [
      { name: "[Content_Types].xml", content: "<Types />" },
      { name: "word/document.xml", content: documentXml },
      { name: "word\\document.xml", content: "<w:document><w:t>ambiguous</w:t></w:document>" }
    ]
  }
]

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

for (const fixture of fixtures) {
  test(`rejects ${fixture.name} before DOCX extraction without staged-upload residue`, async () => {
    // Given
    const directory = dataDirectory()
    const file = new File([duplicateDocx(fixture.entries)], "duplicate.docx", { type: docxMime })

    // When / Then
    await expect(
      previewFile({
        dataDirectory: directory,
        file,
        limits: defaultLocalSecuritySettings()
      })
    ).rejects.toMatchObject({ code: "DOCX_INVALID" } satisfies Partial<IngestionError>)
    expect(readdirSync(join(directory, "preview-uploads"))).toEqual([])
  })
}
