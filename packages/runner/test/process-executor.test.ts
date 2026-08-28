import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ClaimSchema, RUNNER_PROTOCOL_VERSION, RunnerProcessExecutor } from "../src"

const roots: string[] = []
const setup = (body: string, executable: "claude" | "codex") => {
  const root = mkdtempSync(join(tmpdir(), "runner-process-test-"))
  roots.push(root)
  const bin = join(root, "bin")
  Bun.spawnSync(["mkdir", "-p", bin])
  const path = join(bin, executable)
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o700 })
  chmodSync(path, 0o700)
  return { root, bin }
}
const claim = (provider: "claude-cli" | "codex-cli") =>
  ClaimSchema.parse({
    version: RUNNER_PROTOCOL_VERSION,
    type: "claim",
    runId: crypto.randomUUID(),
    leaseId: crypto.randomUUID(),
    provider,
    model: "test-model",
    prompt: "safe prompt",
    requestHash: "a".repeat(64),
    deadline: "2026-08-27T12:00:00.000Z"
  })

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("isolated runner process execution", () => {
  for (const provider of ["claude-cli", "codex-cli"] as const) {
    test(`${provider} receives fixed argv, stdin, sanitized environment, and an isolated cwd`, async () => {
      const executable = provider === "claude-cli" ? "claude" : "codex"
      const harness = setup(
        'printf \'{"argv":"%s","stdin":"%s","cwd":"%s","canary":"%s","git":"%s"}\\n\' "$*" "$(cat)" "$PWD" "${CALLER_CANARY-unset}" "$(test -d .git && echo yes || echo no)"',
        executable
      )
      const result = await new RunnerProcessExecutor({
        capabilities: {
          claudeAuth: "subscription",
          claudeBare: false,
          codexSkipGitRepoCheck: false
        },
        environment: { PATH: `${harness.bin}:/usr/bin:/bin`, CALLER_CANARY: "must-not-pass" },
        temporaryRoot: harness.root
      }).execute(claim(provider))

      expect(result.kind).toBe("completed")
      if (result.kind !== "completed") return
      const output = JSON.parse(result.stdout) as Record<string, string>
      expect(output["stdin"]).toBe("safe prompt")
      expect(output["canary"]).toBe("unset")
      expect(output["cwd"]).toStartWith(realpathSync(harness.root))
      expect(output["git"]).toBe(provider === "codex-cli" ? "yes" : "no")
      expect(readdirSync(harness.root)).toEqual(["bin"])
    })
  }

  test("enforces output and time bounds and removes temporary cwd", async () => {
    const outputHarness = setup("yes x | head -c 4096", "claude")
    const outputResult = await new RunnerProcessExecutor({
      capabilities: {
        claudeAuth: "subscription",
        claudeBare: false,
        codexSkipGitRepoCheck: false
      },
      environment: { PATH: `${outputHarness.bin}:/usr/bin:/bin` },
      temporaryRoot: outputHarness.root,
      outputBytes: 32
    }).execute(claim("claude-cli"))
    expect(outputResult).toEqual({ kind: "failed", code: "output_limit" })

    const timeoutHarness = setup("sleep 10", "claude")
    const timeoutResult = await new RunnerProcessExecutor({
      capabilities: {
        claudeAuth: "subscription",
        claudeBare: false,
        codexSkipGitRepoCheck: false
      },
      environment: { PATH: `${timeoutHarness.bin}:/usr/bin:/bin` },
      temporaryRoot: timeoutHarness.root,
      timeoutMilliseconds: 10
    }).execute(claim("claude-cli"))
    expect(timeoutResult).toEqual({ kind: "failed", code: "timeout" })
  })
})
