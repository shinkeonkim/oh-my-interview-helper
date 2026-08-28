import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPersistence, type Persistence } from "../src/db"
import { RunnerPairingError, RunnerPairingService } from "../src/runner/pairing"

const directories: string[] = []
const handles: Persistence[] = []
const capabilities = {
  protocolVersion: 1,
  claudeSubscription: true,
  claudeDirectAuth: false,
  claudeBare: false,
  codexSkipGitRepoCheck: false,
  claudeVersion: "2.1.0",
  codexVersion: "1.0.0"
}
const setup = (now = Date.parse("2026-08-27T12:00:00.000Z")) => {
  const directory = mkdtempSync(join(tmpdir(), "runner-pairing-"))
  directories.push(directory)
  const persistence = createPersistence({ dataDirectory: directory })
  handles.push(persistence)
  return { persistence, service: new RunnerPairingService(persistence.database, () => now) }
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("one-time runner pairing", () => {
  test("stores only a token hash and authenticates the matching active runner", () => {
    const { persistence, service } = setup()
    const invitation = service.issueCode()
    const paired = service.pair({ code: invitation.code, runnerName: "local", capabilities })
    const databaseText = persistence.database
      .query<{ readonly tokenHash: string }, []>(
        "SELECT token_hash tokenHash FROM runner_registrations"
      )
      .get()

    expect(service.authenticate(paired)).toBeTrue()
    expect(databaseText?.tokenHash).not.toContain(paired.token)
    expect(JSON.stringify(databaseText)).not.toContain(paired.token)
  })

  test("denies reused, forged, expired, and revoked credentials", () => {
    let now = Date.parse("2026-08-27T12:00:00.000Z")
    const directory = mkdtempSync(join(tmpdir(), "runner-pairing-time-"))
    directories.push(directory)
    const persistence = createPersistence({ dataDirectory: directory })
    handles.push(persistence)
    const service = new RunnerPairingService(persistence.database, () => now)
    const invitation = service.issueCode()
    const paired = service.pair({ code: invitation.code, runnerName: "local", capabilities })

    expect(() =>
      service.pair({ code: invitation.code, runnerName: "other", capabilities })
    ).toThrow(RunnerPairingError)
    expect(service.authenticate({ ...paired, token: "forged" })).toBeFalse()
    service.revoke("local")
    expect(service.authenticate(paired)).toBeFalse()

    const expiring = service.issueCode()
    now += 6 * 60_000
    expect(() => service.pair({ code: expiring.code, runnerName: "late", capabilities })).toThrow(
      RunnerPairingError
    )
  })
})
