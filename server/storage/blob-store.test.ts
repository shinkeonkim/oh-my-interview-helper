import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPersistence } from "../src/db/index"
import { BlobIntegrityError, BlobPathError } from "../src/storage/blob-store"

const temporaryDirectories: string[] = []
const makeDataDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-blob-"))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { force: true, recursive: true })
})

describe("content addressed blob storage", () => {
  test("hashes streamed data, deduplicates it, and never accepts a caller path", async () => {
    // Given
    const persistence = createPersistence({ dataDirectory: makeDataDirectory() })

    // When
    const first = await persistence.blobs.put(new Blob(["same bytes"]), "text/plain")
    const second = await persistence.blobs.put(new Blob(["same bytes"]), "text/plain")
    const different = await persistence.blobs.put(new Blob(["different bytes"]), "text/plain")

    // Then
    expect(first).toEqual(second)
    expect(first.sha256).not.toBe(different.sha256)
    expect(() => persistence.blobs.pathFor("../escape")).toThrow(BlobPathError)
    persistence.close()
  })

  test("retains blobs referenced by logically deleted documents and collects only unreferenced metadata", async () => {
    // Given
    const persistence = createPersistence({ dataDirectory: makeDataDirectory() })
    const referenced = await persistence.blobs.put(new Blob(["referenced"]), "text/plain")
    const orphan = await persistence.blobs.put(new Blob(["orphan"]), "text/plain")
    persistence.repositories.blobs.register(referenced)
    persistence.repositories.blobs.register(orphan)
    const document = persistence.repositories.documents.create({
      id: crypto.randomUUID(),
      kind: "resume",
      title: "Resume"
    })
    persistence.repositories.documents.addVersion({
      id: crypto.randomUUID(),
      documentId: document.id,
      blobHash: referenced.sha256
    })

    // When
    persistence.repositories.documents.logicalDelete(document.id)
    const collected = persistence.repositories.blobs.collectUnreferenced(persistence.blobs)

    // Then
    expect(collected).toEqual([orphan.sha256])
    expect(persistence.blobs.exists(referenced.sha256)).toBe(true)
    expect(persistence.blobs.exists(orphan.sha256)).toBe(false)
    persistence.close()
  })

  test("cleans temporary files after a failed streamed write", async () => {
    // Given
    const persistence = createPersistence({ dataDirectory: makeDataDirectory() })
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"))
        controller.error(new Error("interrupted"))
      }
    })

    // When
    await expect(persistence.blobs.put(failing, "application/octet-stream")).rejects.toThrow(
      "interrupted"
    )

    // Then
    expect(
      readdirSync(persistence.blobs.directory).filter((name) => name.includes(".tmp-")).length
    ).toBe(0)
    persistence.close()
  })

  test("rejects a tampered existing dedupe target without replacing it", async () => {
    // Given
    const persistence = createPersistence({ dataDirectory: makeDataDirectory() })
    const blob = await persistence.blobs.put(new Blob(["original"]), "text/plain")
    writeFileSync(persistence.blobs.pathFor(blob.sha256), "tampered")

    await expect(persistence.blobs.put(new Blob(["original"]), "text/plain")).rejects.toThrow(
      BlobIntegrityError
    )
    persistence.close()
  })

  test("retains a blob when a deterministic pre-claim barrier inserts its reference", async () => {
    // Given
    const persistence = createPersistence({ dataDirectory: makeDataDirectory() })
    const blob = await persistence.blobs.put(new Blob(["race"]), "text/plain")
    persistence.repositories.blobs.register(blob)
    const document = persistence.repositories.documents.create({
      id: crypto.randomUUID(),
      kind: "resume",
      title: "Race"
    })

    // When
    const collected = persistence.repositories.blobs.collectUnreferenced(persistence.blobs, {
      beforeClaim: () =>
        persistence.repositories.documents.addVersion({
          id: crypto.randomUUID(),
          documentId: document.id,
          blobHash: blob.sha256
        })
    })

    // Then
    expect(collected).toEqual([])
    expect(persistence.blobs.exists(blob.sha256)).toBe(true)
    persistence.close()
  })

  test("rejects an invalid legacy candidate before deleting any valid orphan", async () => {
    // Given
    const persistence = createPersistence({ dataDirectory: makeDataDirectory() })
    const blob = await persistence.blobs.put(new Blob(["valid"]), "text/plain")
    persistence.repositories.blobs.register(blob)
    const invalid = "g".repeat(64)

    // When / Then
    expect(() =>
      persistence.repositories.blobs.collectUnreferenced(persistence.blobs, {
        candidates: [blob.sha256, invalid]
      })
    ).toThrow()
    expect(persistence.blobs.exists(blob.sha256)).toBe(true)
    persistence.close()
  })
})
