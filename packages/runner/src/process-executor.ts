import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { RunnerClaim } from "./protocol"
import { commandForClaim, type RunnerCliCapabilities } from "./commands"

const ALLOWED_ENVIRONMENT = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "XDG_CONFIG_HOME",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "CODEX_HOME",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY"
] as const

export type RunnerExecutionResult =
  | { readonly kind: "completed"; readonly stdout: string; readonly stderr: string }
  | {
      readonly kind: "failed"
      readonly code: "spawn_failed" | "timeout" | "cancelled" | "output_limit" | "cli_failed"
    }

export type RunnerProcessOptions = {
  readonly capabilities: RunnerCliCapabilities
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly temporaryRoot?: string
  readonly outputBytes?: number
  readonly timeoutMilliseconds?: number
}

export class RunnerProcessExecutor {
  constructor(private readonly options: RunnerProcessOptions) {}

  async execute(claim: RunnerClaim, signal?: AbortSignal): Promise<RunnerExecutionResult> {
    const cwd = mkdtempSync(join(this.options.temporaryRoot ?? tmpdir(), "interview-runner-"))
    try {
      const command = commandForClaim(claim, this.options.capabilities)
      const environment = sanitizedEnvironment(this.options.environment ?? process.env)
      if (command.requiresGitInit) {
        const initialized = Bun.spawnSync(["git", "init", "--quiet"], {
          cwd,
          env: environment,
          stderr: "pipe",
          stdout: "pipe"
        })
        if (initialized.exitCode !== 0) return { kind: "failed", code: "spawn_failed" }
      }
      let child: Bun.Subprocess<"pipe", "pipe", "pipe">
      try {
        child = Bun.spawn([command.executable, ...command.argv], {
          cwd,
          detached: true,
          env: environment,
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe"
        })
      } catch {
        return { kind: "failed", code: "spawn_failed" }
      }
      child.stdin.write(command.stdin)
      child.stdin.end()
      const timeout = AbortSignal.timeout(this.options.timeoutMilliseconds ?? 120_000)
      const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
      const terminate = (): void => terminateProcessGroup(child)
      combined.addEventListener("abort", terminate, { once: true })
      try {
        const limit = this.options.outputBytes ?? 4 * 1024 * 1024
        const [stdout, stderr, exitCode] = await Promise.all([
          readBounded(child.stdout, limit),
          readBounded(child.stderr, limit),
          child.exited
        ])
        if (stdout === null || stderr === null) {
          terminate()
          return { kind: "failed", code: "output_limit" }
        }
        if (combined.aborted)
          return { kind: "failed", code: timeout.aborted ? "timeout" : "cancelled" }
        return exitCode === 0
          ? { kind: "completed", stdout, stderr }
          : { kind: "failed", code: "cli_failed" }
      } finally {
        combined.removeEventListener("abort", terminate)
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  }
}

const sanitizedEnvironment = (
  source: Readonly<Record<string, string | undefined>>
): Record<string, string> =>
  Object.fromEntries(
    ALLOWED_ENVIRONMENT.flatMap((key) => {
      const value = source[key]
      return value === undefined ? [] : [[key, value]]
    })
  )

const readBounded = async (
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number
): Promise<string | null> => {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > maximumBytes) return null
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(output)
}

const terminateProcessGroup = (child: Bun.Subprocess<"pipe", "pipe", "pipe">): void => {
  try {
    process.kill(-child.pid, "SIGTERM")
  } catch {
    child.kill("SIGTERM")
  }
}
