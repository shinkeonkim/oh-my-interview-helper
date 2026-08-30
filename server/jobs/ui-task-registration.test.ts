import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createApp } from "../src/app"
import { createPersistence, type Persistence } from "../src/db"

const directories: string[] = []
const handles: Persistence[] = []
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

test("registers every AI screen as a durable background job", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ui-background-jobs-"))
  directories.push(directory)
  const persistence = createPersistence({ dataDirectory: directory })
  handles.push(persistence)
  const app = createApp({ dataDirectory: directory, persistence })
  const csrf = await app.request("http://localhost:3000/api/security/csrf")
  const headers = {
    Cookie: csrf.headers.get("set-cookie")?.split(";", 1)[0] ?? "",
    "X-CSRF-Token": ((await csrf.json()) as { csrfToken: string }).csrfToken,
    "Content-Type": "application/json"
  }
  for (const kind of ["ui.research", "ui.preparation", "ui.job_discovery", "ui.chat"]) {
    const response = await app.request("http://localhost:3000/api/jobs", {
      method: "POST",
      headers,
      body: JSON.stringify({ kind, input: { request: {} }, idempotencyKey: crypto.randomUUID() })
    })
    expect(response.status).toBe(201)
    expect(((await response.json()) as { state: string }).state).toBe("queued")
  }
})
