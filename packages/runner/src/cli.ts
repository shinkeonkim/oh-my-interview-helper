import { hostname } from "node:os"

import { CliProbe, type CliProbeResult } from "./probes"
import { RunnerConnection, superviseOutboundRunner } from "./connection"
import { pairOutboundRunner } from "./pairing-client"
import { RunnerProcessExecutor } from "./process-executor"
import {
  defaultCredentialsPath,
  loadRunnerCredentials,
  saveRunnerCredentials,
  type StoredRunnerCredentials
} from "./credentials"

type CliOptions = { endpoint: string; credentialsPath: string; runnerName: string }

const options = (
  args: readonly string[]
): { command: "pair" | "run"; value: CliOptions; code: string | undefined } => {
  const [command, ...rest] = args
  if (command !== "pair" && command !== "run")
    throw new Error("Usage: interview-helper-runner <pair|run> [options]")
  const values = new Map<string, string>()
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]
    const value = rest[index + 1]
    if (key === undefined || value === undefined || !key.startsWith("--"))
      throw new Error("Invalid option")
    values.set(key, value)
  }
  return {
    command,
    value: {
      endpoint: values.get("--endpoint") ?? "ws://127.0.0.1:3000/api/runner/ws",
      credentialsPath: values.get("--credentials") ?? defaultCredentialsPath(),
      runnerName: values.get("--name") ?? hostname()
    },
    code: values.get("--code")
  }
}

const inspect = async (): Promise<StoredRunnerCredentials["capabilities"]> => {
  const probe = new CliProbe()
  const [claude, codex] = await Promise.all([probe.inspect("claude"), probe.inspect("codex")])
  if (claude.kind !== "healthy" && codex.kind !== "healthy")
    throw new Error("No supported authenticated CLI is available")
  const healthy = (
    result: CliProbeResult
  ): result is Extract<CliProbeResult, { kind: "healthy" }> => result.kind === "healthy"
  return {
    claudeSubscription: healthy(claude) && process.env["ANTHROPIC_API_KEY"] === undefined,
    claudeDirectAuth: healthy(claude) && process.env["ANTHROPIC_API_KEY"] !== undefined,
    claudeBare: healthy(claude) && claude.capabilities.includes("--bare"),
    codexSkipGitRepoCheck: healthy(codex) && codex.capabilities.includes("--skip-git-repo-check"),
    claudeVersion: healthy(claude) ? claude.version : null,
    codexVersion: healthy(codex) ? codex.version : null
  }
}

const pair = async (value: CliOptions, code: string | undefined): Promise<void> => {
  if (code === undefined) throw new Error("pair requires --code")
  const capabilities = await inspect()
  const accepted = await pairOutboundRunner(value.endpoint, {
    runnerName: value.runnerName,
    pairingCode: code.toUpperCase(),
    capabilities
  })
  saveRunnerCredentials(value.credentialsPath, {
    runnerId: accepted.runnerId,
    token: accepted.token,
    runnerName: value.runnerName,
    endpoint: value.endpoint,
    capabilities
  })
}

const run = async (value: CliOptions): Promise<void> => {
  const stored = loadRunnerCredentials(value.credentialsPath)
  const executor = new RunnerProcessExecutor({
    capabilities: {
      claudeAuth: stored.capabilities.claudeDirectAuth ? "api-key" : "subscription",
      claudeBare: stored.capabilities.claudeBare,
      codexSkipGitRepoCheck: stored.capabilities.codexSkipGitRepoCheck
    }
  })
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  try {
    await superviseOutboundRunner({
      endpoint: stored.endpoint,
      connection: new RunnerConnection(stored, executor),
      signal: controller.signal
    })
  } finally {
    process.off("SIGINT", stop)
    process.off("SIGTERM", stop)
  }
}

export const runnerCli = async (args: readonly string[]): Promise<void> => {
  const parsed = options(args)
  if (parsed.command === "pair") await pair(parsed.value, parsed.code)
  else await run(parsed.value)
}
