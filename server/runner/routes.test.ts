import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createApp } from "../src/app"
import { createPersistence, type Persistence } from "../src/db"
import { RunnerPairingService } from "../src/runner/pairing"

const directories: string[] = []
const handles: Persistence[] = []

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const setup = (revokeRunnerConnection?: (runnerId: string) => void) => {
  const directory = mkdtempSync(join(tmpdir(), "runner-routes-"))
  directories.push(directory)
  const persistence = createPersistence({ dataDirectory: directory })
  handles.push(persistence)
  const pairing = new RunnerPairingService(persistence.database)
  return {
    app: createApp({
      persistence,
      runnerPairing: pairing,
      ...(revokeRunnerConnection === undefined ? {} : { revokeRunnerConnection })
    }),
    pairing
  }
}

const csrf = async (app: ReturnType<typeof createApp>) => {
  const response = await app.request("http://localhost:3000/api/security/csrf")
  const body = (await response.json()) as { csrfToken: string }
  return {
    Cookie: response.headers.get("set-cookie")?.split(";", 1)[0] ?? "",
    "X-CSRF-Token": body.csrfToken
  }
}

describe("runner administration routes", () => {
  test("issues pairing codes only through the local CSRF boundary", async () => {
    const { app } = setup()
    const denied = await app.request("http://localhost:3000/api/runners/pairing-code", {
      method: "POST"
    })
    const accepted = await app.request("http://localhost:3000/api/runners/pairing-code", {
      method: "POST",
      headers: await csrf(app)
    })

    expect(denied.status).toBe(403)
    expect(accepted.status).toBe(201)
    expect(accepted.headers.get("cache-control")).toBe("no-store")
    expect(await accepted.json()).toEqual({
      code: expect.any(String),
      expiresAt: expect.any(String)
    })
  })

  test("lists only non-secret runner metadata and revokes by validated name", async () => {
    let disconnectedRunnerId = ""
    const { app, pairing } = setup((runnerId) => {
      disconnectedRunnerId = runnerId
    })
    const issued = pairing.issueCode()
    pairing.pair({
      code: issued.code,
      runnerName: "desk-runner",
      capabilities: {
        protocolVersion: 1,
        claudeSubscription: true,
        claudeDirectAuth: false,
        claudeBare: false,
        codexSkipGitRepoCheck: true,
        claudeVersion: "claude 1.2.3",
        codexVersion: "codex 1.2.3"
      }
    })

    const listed = await app.request("http://localhost:3000/api/runners")
    const active = await listed.json()
    const revoked = await app.request("http://localhost:3000/api/runners/desk-runner", {
      method: "DELETE",
      headers: await csrf(app)
    })
    const after = await (await app.request("http://localhost:3000/api/runners")).json()

    expect(listed.status).toBe(200)
    expect(listed.headers.get("cache-control")).toBe("no-store")
    expect(active).toMatchObject({
      runners: [{ runnerName: "desk-runner", status: "active" }]
    })
    expect(JSON.stringify(active)).not.toMatch(/token|hash/i)
    expect(revoked.status).toBe(204)
    expect(disconnectedRunnerId).toBeString()
    expect(after).toMatchObject({
      runners: [{ runnerName: "desk-runner", status: "revoked", revokedAt: expect.any(String) }]
    })
  })
})
