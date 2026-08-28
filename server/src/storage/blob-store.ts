import { createHash, randomUUID } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
  readdirSync,
  unlinkSync,
  linkSync
} from "node:fs"
import { open, rm } from "node:fs/promises"
import { relative, resolve } from "node:path"

const HashSchema = /^[a-f0-9]{64}$/
export type BlobRecord = {
  readonly sha256: string
  readonly byteSize: number
  readonly mediaType: string
}

export class BlobPathError extends Error {
  override readonly name = "BlobPathError"
  constructor() {
    super("BLOB_PATH_ERROR")
  }
}
export class BlobIntegrityError extends Error {
  override readonly name = "BlobIntegrityError"
  constructor() {
    super("BLOB_INTEGRITY_ERROR")
  }
}

const assertContained = (directory: string, candidate: string): string => {
  const relativePath = relative(directory, candidate)
  if (relativePath === "" || relativePath.startsWith("..") || relativePath.includes("../"))
    throw new BlobPathError()
  return candidate
}

export class BlobStore {
  readonly directory: string
  constructor(dataDirectory: string) {
    this.directory = resolve(dataDirectory, "blobs")
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
  }

  pathFor(sha256: string): string {
    if (!HashSchema.test(sha256)) throw new BlobPathError()
    return assertContained(this.directory, resolve(this.directory, sha256))
  }

  exists(sha256: string): boolean {
    return existsSync(this.pathFor(sha256))
  }

  async put(source: Blob | ReadableStream<Uint8Array>, mediaType: string): Promise<BlobRecord> {
    const temporaryPath = assertContained(
      this.directory,
      resolve(this.directory, `.tmp-${randomUUID()}`)
    )
    const file = await open(temporaryPath, "wx", 0o600)
    const hash = createHash("sha256")
    let byteSize = 0
    try {
      const reader = (source instanceof Blob ? source.stream() : source).getReader()
      for (;;) {
        const result = await reader.read()
        if (result.done) break
        hash.update(result.value)
        byteSize += result.value.byteLength
        await file.write(result.value)
      }
      await file.sync()
      await file.close()
      const sha256 = hash.digest("hex")
      const finalPath = this.pathFor(sha256)
      let created = true
      try {
        linkSync(temporaryPath, finalPath)
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("EEXIST")) throw error
        created = false
      }
      unlinkSync(temporaryPath)
      if (!created) await this.verify(finalPath, sha256, byteSize)
      const directoryHandle = openSync(this.directory, "r")
      fsyncSync(directoryHandle)
      closeSync(directoryHandle)
      return { sha256, byteSize, mediaType }
    } catch (error) {
      await file.close()
      await rm(temporaryPath, { force: true })
      throw error
    }
  }

  private async verify(path: string, expectedHash: string, expectedSize: number): Promise<void> {
    const hash = createHash("sha256")
    let byteSize = 0
    const reader = Bun.file(path).stream().getReader()
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      hash.update(result.value)
      byteSize += result.value.byteLength
    }
    if (hash.digest("hex") !== expectedHash || byteSize !== expectedSize)
      throw new BlobIntegrityError()
  }

  remove(sha256: string): void {
    if (this.exists(sha256)) unlinkSync(this.pathFor(sha256))
  }
  temporaryFiles(): readonly string[] {
    return readdirSync(this.directory).filter((name) => name.startsWith(".tmp-"))
  }
}
