import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { normalizeCliOutputLine } from "@interview-helper/runner"

import type { CliProviderId, CliRunnerTransport, CliTransportEvent } from "./cli-runner"

export class LocalCliTransport implements CliRunnerTransport {
  constructor(private readonly timeoutMilliseconds = 300_000) {}

  connected(provider: CliProviderId): boolean {
    return Bun.which(executable(provider)) !== null
  }

  async *stream(input: {
    readonly provider: CliProviderId
    readonly model: string
    readonly prompt: string
    readonly signal?: AbortSignal
  }): AsyncIterable<CliTransportEvent> {
    if (!this.connected(input.provider)) throw new Error("LOCAL_CLI_UNAVAILABLE")
    const directory = mkdtempSync(join(tmpdir(), "interview-local-agent-"))
    try {
      const child = Bun.spawn([...localCliCommand(input.provider, input.model)], {
        cwd: directory,
        detached: true,
        env: process.env,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe"
      })
      child.stdin.write(input.prompt)
      child.stdin.end()
      const timeout = AbortSignal.timeout(this.timeoutMilliseconds)
      const signal = input.signal === undefined ? timeout : AbortSignal.any([input.signal, timeout])
      const terminate = (): void => terminateProcessGroup(child)
      signal.addEventListener("abort", terminate, { once: true })
      try {
        const [stdout, , exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited
        ])
        if (signal.aborted) throw new Error("LOCAL_CLI_CANCELLED")
        if (exitCode !== 0 || stdout.length > 4 * 1024 * 1024) throw new Error("LOCAL_CLI_FAILED")
        for (const line of stdout.split("\n").filter(Boolean)) {
          const event = normalizeCliOutputLine(input.provider, line)
          if (event !== null) yield event
        }
      } finally {
        signal.removeEventListener("abort", terminate)
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

export class PreferredCliTransport implements CliRunnerTransport {
  constructor(
    private readonly remote: CliRunnerTransport,
    private readonly local: CliRunnerTransport
  ) {}

  connected(provider: CliProviderId): boolean {
    return this.remote.connected(provider) || this.local.connected(provider)
  }

  stream(input: Parameters<CliRunnerTransport["stream"]>[0]): AsyncIterable<CliTransportEvent> {
    return (this.remote.connected(input.provider) ? this.remote : this.local).stream(input)
  }
}

const executable = (provider: CliProviderId): "claude" | "codex" =>
  provider === "claude-cli" ? "claude" : "codex"

export const localCliCommand = (provider: CliProviderId, model: string): readonly string[] =>
  provider === "claude-cli"
    ? [
        "claude",
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--no-session-persistence",
        "--permission-mode",
        "dontAsk",
        "--restricted",
        "--tools",
        "",
        "--model",
        model
      ]
    : [
        "codex",
        "exec",
        "--json",
        "--ephemeral",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--model",
        model,
        "-"
      ]

const terminateProcessGroup = (child: Bun.Subprocess): void => {
  try {
    process.kill(-child.pid, "SIGTERM")
  } catch {
    child.kill("SIGTERM")
  }
}
