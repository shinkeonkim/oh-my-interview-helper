import { describe, expect, test } from "bun:test"

import {
  ClaimSchema,
  RUNNER_PROTOCOL_VERSION,
  RunnerInboundMessageSchema,
  commandForClaim
} from "../src"

const claim = ClaimSchema.parse({
  version: RUNNER_PROTOCOL_VERSION,
  type: "claim",
  runId: crypto.randomUUID(),
  leaseId: crypto.randomUUID(),
  provider: "claude-cli",
  model: "sonnet",
  prompt: "hello",
  requestHash: "a".repeat(64),
  deadline: "2026-08-27T12:00:00.000Z"
})

describe("runner protocol and fixed commands", () => {
  test("rejects protocol mismatch and caller-selected process fields", () => {
    expect(() => RunnerInboundMessageSchema.parse({ ...claim, version: 2 })).toThrow()
    expect(() =>
      ClaimSchema.parse({
        ...claim,
        executable: "/bin/sh",
        argv: ["-c", "danger"],
        cwd: "/",
        env: { TOKEN: "canary" }
      })
    ).toThrow()
  })

  test("uses OAuth-compatible Claude arguments without bare", () => {
    expect(
      commandForClaim(claim, {
        claudeAuth: "subscription",
        claudeBare: true,
        codexSkipGitRepoCheck: false
      })
    ).toEqual({
      executable: "claude",
      argv: [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--no-session-persistence",
        "--permission-mode",
        "dontAsk",
        "--model",
        "sonnet"
      ],
      stdin: "hello",
      requiresGitInit: false
    })
  })

  test("permits bare only for the separately probed Claude API-key profile", () => {
    expect(
      commandForClaim(claim, {
        claudeAuth: "api-key",
        claudeBare: true,
        codexSkipGitRepoCheck: false
      }).argv[0]
    ).toBe("--bare")
  })

  test("uses an isolated read-only Codex command and requires an empty Git repository", () => {
    const command = commandForClaim(
      { ...claim, provider: "codex-cli", model: "gpt-5.4" },
      { claudeAuth: "subscription", claudeBare: false, codexSkipGitRepoCheck: false }
    )
    expect(command).toEqual({
      executable: "codex",
      argv: ["exec", "--json", "--ephemeral", "--sandbox", "read-only", "--model", "gpt-5.4", "-"],
      stdin: "hello",
      requiresGitInit: true
    })
  })
})
