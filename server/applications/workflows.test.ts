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
  const directory = mkdtempSync(join(tmpdir(), "application-workflows-"))
  directories.push(directory)
  const persistence = createPersistence({ dataDirectory: directory })
  handles.push(persistence)
  const resolver: Resolver = { resolve: async () => ["93.184.216.34"] }
  let transportRequests = 0
  const transport: PinnedTransport = {
    request: async () => {
      transportRequests += 1
      return {
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        body: (async function* () {
          yield new TextEncoder().encode("<h1>URL posting</h1>")
        })()
      }
    }
  }
  const app = createApp({ dataDirectory: directory, persistence, resolver, transport })
  const csrfResponse = await app.request(`${base}/security/csrf`)
  const token = ((await csrfResponse.json()) as { csrfToken: string }).csrfToken
  const headers = {
    Cookie: csrfResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? "",
    "X-CSRF-Token": token
  }
  return { app, headers, persistence, transportRequestCount: () => transportRequests }
}

describe("job posting and hiring pipeline API", () => {
  test("ingests manual, file, and pinned URL postings with immutable versions", async () => {
    const { app, headers, persistence, transportRequestCount } = await setup()
    const jsonHeaders = { ...headers, "Content-Type": "application/json" }
    const manual = await app.request(`${base}/postings/manual`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        title: "Backend",
        companyName: "Acme",
        teamName: "Platform",
        text: "Manual body"
      })
    })
    expect(manual.status).toBe(201)
    const manualPost = (await manual.json()) as { id: string }
    const file = new FormData()
    file.set("title", "Frontend")
    file.set("companyName", "Beta")
    file.set("file", new File(["File body"], "post.txt", { type: "text/plain" }))
    expect(
      (await app.request(`${base}/postings/file`, { method: "POST", headers, body: file })).status
    ).toBe(201)
    expect(
      (
        await app.request(`${base}/postings/url`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            title: "Data",
            companyName: "Gamma",
            teamName: null,
            url: "https://jobs.example/role?secret=no"
          })
        })
      ).status
    ).toBe(201)
    await app.request(`${base}/postings/${manualPost.id}/versions/manual`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ text: "Manual body v2" })
    })
    const versions = (await (
      await app.request(`${base}/postings/${manualPost.id}/versions`)
    ).json()) as { versions: Array<{ versionNumber: number }> }
    expect(versions.versions.map((version) => version.versionNumber)).toEqual([2, 1])
    expect(
      ((await (await app.request(`${base}/postings`)).json()) as { postings: unknown[] }).postings
    ).toHaveLength(3)

    const blobCount = () =>
      persistence.database.query<{ count: number }, []>("SELECT COUNT(*) count FROM blobs").get()
        ?.count ?? 0
    const blobsBeforeArchive = blobCount()
    const requestsBeforeArchive = transportRequestCount()
    expect(
      (
        await app.request(`${base}/postings/${manualPost.id}/archive`, {
          method: "POST",
          headers
        })
      ).status
    ).toBe(204)
    expect(
      (
        await app.request(`${base}/postings/${manualPost.id}/versions/manual`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ text: "must not persist" })
        })
      ).status
    ).toBe(400)
    const archivedFile = new FormData()
    archivedFile.set("file", new File(["must not extract"], "post.txt", { type: "text/plain" }))
    expect(
      (
        await app.request(`${base}/postings/${manualPost.id}/versions/file`, {
          method: "POST",
          headers,
          body: archivedFile
        })
      ).status
    ).toBe(400)
    expect(
      (
        await app.request(`${base}/postings/${manualPost.id}/versions/url`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ url: "https://jobs.example/archived" })
        })
      ).status
    ).toBe(400)
    expect(blobCount()).toBe(blobsBeforeArchive)
    expect(transportRequestCount()).toBe(requestsBeforeArchive)
    expect(
      (
        (await (await app.request(`${base}/postings/${manualPost.id}/versions`)).json()) as {
          versions: unknown[]
        }
      ).versions
    ).toHaveLength(2)
  })

  test("enforces idempotency and terminal transitions while retaining notes and interview history", async () => {
    const { app, headers } = await setup()
    const jsonHeaders = { ...headers, "Content-Type": "application/json" }
    const post = (await (
      await app.request(`${base}/postings/manual`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          title: "Backend",
          companyName: "Acme",
          teamName: null,
          text: "Body"
        })
      })
    ).json()) as { id: string }
    const idempotencyKey = crypto.randomUUID()
    const create = () =>
      app.request(`${base}/applications`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ jobPostId: post.id, idempotencyKey })
      })
    const first = await create()
    const application = (await first.json()) as { id: string }
    expect((await create()).status).toBe(201)
    expect(
      (
        await app.request(`${base}/applications`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ jobPostId: post.id, idempotencyKey: crypto.randomUUID() })
        })
      ).status
    ).toBe(409)
    expect(
      ((await (await app.request(`${base}/applications`)).json()) as { applications: unknown[] })
        .applications
    ).toHaveLength(1)
    const stages = (
      (await (await app.request(`${base}/pipeline/stages`)).json()) as {
        stages: Array<{ id: string; key: string }>
      }
    ).stages
    const interviewing = stages.find((stage) => stage.key === "interviewing")
    const offered = stages.find((stage) => stage.key === "offered")
    if (interviewing === undefined || offered === undefined)
      throw new Error("default stages missing")
    await app.request(`${base}/applications/${application.id}/transition`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ stageId: interviewing.id })
    })
    await app.request(`${base}/applications/${application.id}/notes`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ text: "Prepare system design" })
    })
    await app.request(`${base}/applications/${application.id}/interviews`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        scheduledAt: "2026-09-01T01:00:00.000Z",
        kind: "technical",
        location: "Seoul",
        notes: "Panel"
      })
    })
    expect(
      (
        await app.request(`${base}/applications/${application.id}/transition`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ stageId: offered.id })
        })
      ).status
    ).toBe(200)
    expect(
      (
        await app.request(`${base}/applications/${application.id}/transition`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ stageId: interviewing.id })
        })
      ).status
    ).toBe(409)
    const afterDeniedTransition = (
      (await (await app.request(`${base}/applications`)).json()) as {
        applications: Array<{ id: string; stageId: string; outcomeAt: string | null }>
      }
    ).applications.find((item) => item.id === application.id)
    expect(afterDeniedTransition?.stageId).toBe(offered.id)
    expect(afterDeniedTransition?.outcomeAt).not.toBeNull()
    const history = (await (
      await app.request(`${base}/applications/${application.id}/history`)
    ).json()) as { events: unknown[]; interviews: unknown[] }
    expect(history.events).toHaveLength(5)
    expect(history.interviews).toHaveLength(1)
    expect(
      (
        await app.request(`${base}/applications/${application.id}/archive`, {
          method: "POST",
          headers
        })
      ).status
    ).toBe(204)
    expect(
      (
        await app.request(`${base}/applications/${application.id}/notes`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ text: "Late mutation" })
        })
      ).status
    ).toBe(400)
    expect(
      (
        await app.request(`${base}/applications/${application.id}/interviews`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            scheduledAt: "2026-09-02T01:00:00.000Z",
            kind: "late interview"
          })
        })
      ).status
    ).toBe(400)
    const archivedHistory = (await (
      await app.request(`${base}/applications/${application.id}/history`)
    ).json()) as { events: unknown[]; interviews: unknown[] }
    expect(archivedHistory.events).toHaveLength(5)
    expect(archivedHistory.interviews).toHaveLength(1)

    expect(
      (
        await app.request(`${base}/postings/${post.id}/archive`, {
          method: "POST",
          headers
        })
      ).status
    ).toBe(204)
    const retried = await create()
    expect(retried.status).toBe(201)
    expect(((await retried.json()) as { id: string }).id).toBe(application.id)
    expect(
      (
        await app.request(`${base}/applications`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ jobPostId: post.id, idempotencyKey: crypto.randomUUID() })
        })
      ).status
    ).toBe(400)
    expect(
      ((await (await app.request(`${base}/applications`)).json()) as { applications: unknown[] })
        .applications
    ).toHaveLength(1)
  })

  test("allows bounded custom stage CRUD and rejects deleted-stage transitions atomically", async () => {
    const { app, headers } = await setup()
    const jsonHeaders = { ...headers, "Content-Type": "application/json" }
    const created = await app.request(`${base}/pipeline/stages`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ key: "onsite", name: "Onsite" })
    })
    const stage = (await created.json()) as { id: string }
    expect(created.status).toBe(201)
    expect(
      (
        await app.request(`${base}/pipeline/stages/${stage.id}`, {
          method: "PATCH",
          headers: jsonHeaders,
          body: JSON.stringify({ name: "Final onsite" })
        })
      ).status
    ).toBe(204)
    const beforeOrder = (
      (await (await app.request(`${base}/pipeline/stages`)).json()) as {
        stages: Array<{ id: string }>
      }
    ).stages.map((item) => item.id)
    expect(
      (
        await app.request(`${base}/pipeline/stages/order`, {
          method: "PUT",
          headers: jsonHeaders,
          body: JSON.stringify({ stageIds: [...beforeOrder].reverse() })
        })
      ).status
    ).toBe(204)
    expect(
      (await app.request(`${base}/pipeline/stages/${stage.id}`, { method: "DELETE", headers }))
        .status
    ).toBe(204)
    expect(
      ((await (await app.request(`${base}/pipeline/stages`)).json()) as { stages: unknown[] })
        .stages
    ).toHaveLength(6)
    expect(
      (
        await app.request(`${base}/pipeline/stages/${beforeOrder[0] ?? "missing"}`, {
          method: "DELETE",
          headers
        })
      ).status
    ).toBe(400)
  })
})
