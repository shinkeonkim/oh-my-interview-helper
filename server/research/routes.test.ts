import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createApp } from "../src/app"
import { createPersistence, type Persistence } from "../src/db"
import type { PinnedTransport, Resolver } from "../src/ingest/safe-fetcher"

const directories: string[] = []
const handles: Persistence[] = []
const base = "http://localhost:3000/api"

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const setup = async () => {
  const directory = mkdtempSync(join(tmpdir(), "research-routes-"))
  directories.push(directory)
  const persistence = createPersistence({ dataDirectory: directory })
  handles.push(persistence)
  const resolver: Resolver = { resolve: async () => ["93.184.216.34"] }
  const transport: PinnedTransport = {
    request: async () => ({
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      body: (async function* () {
        yield new TextEncoder().encode("<h1>Acme Engineering</h1><p>Public profile</p>")
      })()
    })
  }
  const app = createApp({ dataDirectory: directory, persistence, resolver, transport })
  const csrfResponse = await app.request(`${base}/security/csrf`)
  const csrf = (await csrfResponse.json()) as { csrfToken: string }
  return {
    app,
    headers: {
      Cookie: csrfResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? "",
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf.csrfToken
    }
  }
}

describe("cited research API", () => {
  test("requires CSRF and preserves citations across create, read, list, and refresh", async () => {
    const { app, headers } = await setup()
    const request = {
      subjectType: "team_lead",
      subjectName: "Kim",
      organization: "Acme",
      roleHint: "Platform",
      jobPostId: null,
      sourceUrls: ["https://example.com/profile"],
      parentRecordId: null
    }
    expect(
      (
        await app.request(`${base}/research`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request)
        })
      ).status
    ).toBe(403)

    for (const sourceUrl of [
      "ftp://example.com/profile",
      "https://user:secret@example.com/profile"
    ])
      expect(
        (
          await app.request(`${base}/research`, {
            method: "POST",
            headers,
            body: JSON.stringify({ ...request, sourceUrls: [sourceUrl] })
          })
        ).status
      ).toBe(400)

    const createdResponse = await app.request(`${base}/research`, {
      method: "POST",
      headers,
      body: JSON.stringify(request)
    })
    expect(createdResponse.status).toBe(201)
    const created = (await createdResponse.json()) as {
      id: string
      identityStatus: string
      sources: Array<{ id: string }>
      claims: Array<{ sourceIds: string[] }>
    }
    expect(created.identityStatus).toBe("ambiguous")
    expect(created.claims[0]?.sourceIds).toEqual([created.sources[0]?.id])

    const listed = (await (await app.request(`${base}/research`)).json()) as {
      records: Array<{ id: string }>
    }
    expect(listed.records.map((record) => record.id)).toEqual([created.id])
    expect((await app.request(`${base}/research/${created.id}`)).status).toBe(200)

    const refreshedResponse = await app.request(`${base}/research/${created.id}/refresh`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sourceUrls: ["https://example.com/profile-updated"] })
    })
    expect(refreshedResponse.status).toBe(201)
    expect(((await refreshedResponse.json()) as { parentRecordId: string }).parentRecordId).toBe(
      created.id
    )
    expect(
      (
        await app.request(`${base}/research/${created.id}/refresh`, {
          method: "POST",
          headers,
          body: JSON.stringify({ sourceUrls: ["ftp://example.com/profile"] })
        })
      ).status
    ).toBe(400)
  })
})
