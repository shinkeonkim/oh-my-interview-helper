import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createApp } from "../src/app"
import { createPersistence, type Persistence } from "../src/db"

const directories: string[] = []
const handles: Persistence[] = []
const url = (path: string) => `http://localhost:3000${path}`

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const setup = async () => {
  const directory = mkdtempSync(join(tmpdir(), "document-library-"))
  directories.push(directory)
  const persistence = createPersistence({ dataDirectory: directory })
  handles.push(persistence)
  const app = createApp({ dataDirectory: directory, persistence })
  const csrfResponse = await app.request(url("/api/security/csrf"))
  const body = (await csrfResponse.json()) as { csrfToken: string }
  const headers = {
    Cookie: csrfResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? "",
    "X-CSRF-Token": body.csrfToken
  }
  return { app, headers, persistence }
}

describe("uploaded career document library", () => {
  test("uploads multiple documents, deduplicates blobs, versions one document, and composes only selected context", async () => {
    const { app, headers, persistence } = await setup()
    const form = new FormData()
    form.set("kind", "resume")
    form.append("files", new File(["same profile"], "resume-a.txt", { type: "text/plain" }))
    form.append("files", new File(["same profile"], "resume-b.txt", { type: "text/plain" }))
    const uploaded = await app.request(url("/api/documents/upload"), {
      method: "POST",
      headers,
      body: form
    })
    const payload = (await uploaded.json()) as { documents: Array<{ id: string }> }

    expect(uploaded.status).toBe(201)
    expect(payload.documents).toHaveLength(2)
    expect(
      persistence.database.query<{ count: number }, []>("SELECT count(*) count FROM blobs").get()
        ?.count
    ).toBe(1)

    const first = payload.documents[0]?.id ?? ""
    const version = new FormData()
    version.set("file", new File(["updated profile"], "resume-v2.txt", { type: "text/plain" }))
    expect(
      (
        await app.request(url(`/api/documents/${first}/versions`), {
          method: "POST",
          headers,
          body: version
        })
      ).status
    ).toBe(201)
    expect(
      (
        (await (await app.request(url(`/api/documents/${first}/versions`))).json()) as {
          versions: unknown[]
        }
      ).versions
    ).toHaveLength(2)

    await app.request(url(`/api/documents/${first}/selection`), { method: "PUT", headers })
    const context = (await (await app.request(url("/api/documents/context"))).json()) as {
      documents: Array<{ text: string }>
    }
    expect(context.documents).toEqual([expect.objectContaining({ text: "updated profile" })])

    await app.request(url(`/api/documents/${first}/archive`), { method: "POST", headers })
    expect(
      (await (await app.request(url("/api/documents/context"))).json()) as { documents: unknown[] }
    ).toEqual({ documents: [] })
    expect(
      (
        await app.request(url(`/api/documents/${first}/selection`), {
          method: "PUT",
          headers
        })
      ).status
    ).toBe(409)
    expect(
      persistence.database
        .query<{ count: number }, [string]>(
          "SELECT count(*) count FROM profile_document_selections WHERE document_id=?"
        )
        .get(first)?.count
    ).toBe(0)

    const blobCount = () =>
      persistence.database.query<{ count: number }, []>("SELECT count(*) count FROM blobs").get()
        ?.count ?? 0
    const blobsBeforeRejectedVersion = blobCount()
    const rejectedVersion = new FormData()
    rejectedVersion.set(
      "file",
      new File(["must not persist"], "archived-v3.txt", { type: "text/plain" })
    )
    expect(
      (
        await app.request(url(`/api/documents/${first}/versions`), {
          method: "POST",
          headers,
          body: rejectedVersion
        })
      ).status
    ).toBe(409)
    expect(blobCount()).toBe(blobsBeforeRejectedVersion)
    expect(
      (
        (await (await app.request(url(`/api/documents/${first}/versions`))).json()) as {
          versions: unknown[]
        }
      ).versions
    ).toHaveLength(2)

    expect(
      (
        await app.request(url(`/api/documents/${first}/delete`), {
          method: "POST",
          headers
        })
      ).status
    ).toBe(204)
    const remaining = (await (await app.request(url("/api/documents"))).json()) as {
      documents: Array<{ id: string }>
    }
    expect(remaining.documents.some((document) => document.id === first)).toBe(false)
  })

  test("previews and downloads originals while returning actionable extraction failures", async () => {
    const { app, headers, persistence } = await setup()
    const manual = await app.request(url("/api/documents/manual"), {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "portfolio", title: "Work", text: "Local evidence" })
    })
    const document = (await manual.json()) as { id: string }
    expect(
      (await (await app.request(url(`/api/documents/${document.id}/preview`))).json()) as {
        text: string
      }
    ).toEqual(expect.objectContaining({ text: "Local evidence" }))
    expect(await (await app.request(url(`/api/documents/${document.id}/download`))).text()).toBe(
      "Local evidence"
    )

    const corrupt = new FormData()
    corrupt.set("kind", "supporting")
    corrupt.set("files", new File(["not pdf"], "bad.pdf", { type: "application/pdf" }))
    const failed = await app.request(url("/api/documents/upload"), {
      method: "POST",
      headers,
      body: corrupt
    })
    expect(failed.status).toBe(422)
    expect(await failed.json()).toEqual({ error: { code: "MAGIC_MISMATCH" } })

    const documentCount = () =>
      persistence.database
        .query<{ count: number }, []>("SELECT count(*) count FROM documents")
        .get()?.count ?? 0
    const blobCount = () =>
      persistence.database.query<{ count: number }, []>("SELECT count(*) count FROM blobs").get()
        ?.count ?? 0
    const documentsBeforeBatch = documentCount()
    const blobsBeforeBatch = blobCount()
    const mixed = new FormData()
    mixed.set("kind", "resume")
    mixed.append("files", new File(["valid profile"], "valid.txt", { type: "text/plain" }))
    mixed.append("files", new File(["not pdf"], "invalid.pdf", { type: "application/pdf" }))
    const rejectedBatch = await app.request(url("/api/documents/upload"), {
      method: "POST",
      headers,
      body: mixed
    })
    expect(rejectedBatch.status).toBe(422)
    expect(documentCount()).toBe(documentsBeforeBatch)
    expect(blobCount()).toBe(blobsBeforeBatch)
  })
})
