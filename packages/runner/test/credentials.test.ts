import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { loadRunnerCredentials, saveRunnerCredentials } from "../src"

const directories: string[] = []
const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), "interview-runner-credentials-"))
  directories.push(directory)
  return {
    path: join(directory, "nested", "runner.json"),
    value: {
      runnerId: "11111111-1111-4111-8111-111111111111",
      token: "a".repeat(32),
      runnerName: "local-runner",
      endpoint: "ws://127.0.0.1:3000/api/runner/ws",
      capabilities: {
        claudeSubscription: true,
        claudeDirectAuth: false,
        claudeBare: false,
        codexSkipGitRepoCheck: true,
        claudeVersion: "claude 1.2.3",
        codexVersion: "codex 1.2.3"
      }
    }
  } as const
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("runner credential storage", () => {
  test("writes only the validated credential document with private permissions", () => {
    const item = fixture()
    saveRunnerCredentials(item.path, item.value)

    expect(loadRunnerCredentials(item.path)).toEqual(item.value)
    expect(statSync(item.path).mode & 0o777).toBe(0o600)
    expect(statSync(dirname(item.path)).mode & 0o777).toBe(0o700)
    expect(readFileSync(item.path, "utf8")).not.toContain("ANTHROPIC_API_KEY")
  })

  test("rejects malformed or extended credential documents", () => {
    const item = fixture()
    saveRunnerCredentials(item.path, item.value)
    writeFileSync(item.path, JSON.stringify({ ...item.value, unexpected: "value" }))

    expect(() => loadRunnerCredentials(item.path)).toThrow()
  })
})
