import { describe, expect, test } from "bun:test"

import { CliProbe, type CliKind, type ProbeCommand, type ProbeCommandResult } from "../src"

const success =
  (kind: CliKind) =>
  async (command: ProbeCommand): Promise<ProbeCommandResult> => {
    if (command.argv.includes("--version"))
      return { exitCode: 0, stdout: `${kind} 1.2.3`, stderr: "" }
    if (command.argv.includes("--help"))
      return {
        exitCode: 0,
        stdout:
          kind === "claude"
            ? "--output-format --verbose --include-partial-messages --no-session-persistence --permission-mode --bare"
            : "--json --ephemeral --sandbox --skip-git-repo-check",
        stderr: ""
      }
    if (command.argv.includes("status"))
      return { exitCode: 0, stdout: "authenticated account-canary", stderr: "" }
    return { exitCode: 0, stdout: '{"result":"OK"}', stderr: "" }
  }

describe("fixed CLI health probes", () => {
  for (const kind of ["claude", "codex"] as const) {
    test(`${kind} requires version, flags, auth, and a zero-tool minimal run`, async () => {
      const calls: ProbeCommand[] = []
      const result = await new CliProbe(async (command) => {
        calls.push(command)
        return success(kind)(command)
      }).inspect(kind)

      expect(result).toEqual(expect.objectContaining({ kind: "healthy", version: `${kind} 1.2.3` }))
      expect(calls.map((call) => call.executable)).toEqual([kind, kind, kind, kind])
      expect(JSON.stringify(result)).not.toContain("account-canary")
      expect(calls[3]?.stdin).toContain("Do not use tools")
    })
  }

  test("returns typed failures for missing flags, auth, and minimal execution", async () => {
    const missingFlag = await new CliProbe(async (command) => {
      const result = await success("codex")(command)
      return command.argv.includes("--help") ? { ...result, stdout: "--json" } : result
    }).inspect("codex")
    const authFailure = await new CliProbe(async (command) => {
      const result = await success("claude")(command)
      return command.argv.includes("status") ? { ...result, exitCode: 1 } : result
    }).inspect("claude")
    const minimalFailure = await new CliProbe(async (command) => {
      const result = await success("codex")(command)
      return command.stdin === undefined ? result : { ...result, stdout: "not-ready" }
    }).inspect("codex")

    expect(missingFlag).toEqual({ kind: "unavailable", code: "missing_flag" })
    expect(authFailure).toEqual({ kind: "unavailable", code: "unauthenticated" })
    expect(minimalFailure).toEqual({ kind: "unavailable", code: "minimal_run_failed" })
  })
})
