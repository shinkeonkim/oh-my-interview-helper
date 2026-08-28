export type CliKind = "claude" | "codex"
export type ProbeCommand = {
  readonly executable: CliKind
  readonly argv: readonly string[]
  readonly stdin?: string
}
export type ProbeCommandResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}
export type ProbeCommandRunner = (command: ProbeCommand) => Promise<ProbeCommandResult>
export type CliProbeResult =
  | {
      readonly kind: "healthy"
      readonly version: string
      readonly capabilities: readonly string[]
    }
  | {
      readonly kind: "unavailable"
      readonly code:
        | "missing"
        | "unsupported_version"
        | "missing_flag"
        | "unauthenticated"
        | "minimal_run_failed"
    }

const requiredFlags: Record<CliKind, readonly string[]> = {
  claude: [
    "--output-format",
    "--verbose",
    "--include-partial-messages",
    "--no-session-persistence",
    "--permission-mode"
  ],
  codex: ["--json", "--ephemeral", "--sandbox"]
}

export class CliProbe {
  constructor(private readonly run: ProbeCommandRunner = runProbeCommand) {}

  async inspect(kind: CliKind): Promise<CliProbeResult> {
    const version = await this.safe({ executable: kind, argv: ["--version"] })
    if (version === null) return { kind: "unavailable", code: "missing" }
    const versionText = `${version.stdout}\n${version.stderr}`.trim()
    if (version.exitCode !== 0 || !/\d+\.\d+(?:\.\d+)?/.test(versionText))
      return { kind: "unavailable", code: "unsupported_version" }
    const help = await this.safe({
      executable: kind,
      argv: kind === "claude" ? ["--help"] : ["exec", "--help"]
    })
    if (
      help === null ||
      help.exitCode !== 0 ||
      requiredFlags[kind].some((flag) => !`${help.stdout}\n${help.stderr}`.includes(flag))
    )
      return { kind: "unavailable", code: "missing_flag" }
    const auth = await this.safe({
      executable: kind,
      argv: kind === "claude" ? ["auth", "status"] : ["login", "status"]
    })
    if (auth === null || auth.exitCode !== 0)
      return { kind: "unavailable", code: "unauthenticated" }
    const minimal = await this.safe(minimalCommand(kind))
    if (
      minimal === null ||
      minimal.exitCode !== 0 ||
      !`${minimal.stdout}\n${minimal.stderr}`.toLowerCase().includes("ok")
    )
      return { kind: "unavailable", code: "minimal_run_failed" }
    return {
      kind: "healthy",
      version: versionText.slice(0, 128),
      capabilities: [
        ...requiredFlags[kind],
        ...(help.stdout.includes("--skip-git-repo-check") ? ["--skip-git-repo-check"] : []),
        ...(help.stdout.includes("--bare") ? ["--bare"] : [])
      ]
    }
  }

  private async safe(command: ProbeCommand): Promise<ProbeCommandResult | null> {
    try {
      return await this.run(command)
    } catch {
      return null
    }
  }
}

const minimalCommand = (kind: CliKind): ProbeCommand =>
  kind === "claude"
    ? {
        executable: "claude",
        argv: [
          "-p",
          "--output-format",
          "json",
          "--no-session-persistence",
          "--permission-mode",
          "dontAsk"
        ],
        stdin: "Reply with exactly OK. Do not use tools."
      }
    : {
        executable: "codex",
        argv: ["exec", "--json", "--ephemeral", "--sandbox", "read-only", "-"],
        stdin: "Reply with exactly OK. Do not use tools."
      }

const runProbeCommand: ProbeCommandRunner = async ({ executable, argv, stdin }) => {
  const child = Bun.spawn([executable, ...argv], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe"
  })
  if (stdin !== undefined) child.stdin.write(stdin)
  child.stdin.end()
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited
  ])
  return { exitCode, stdout, stderr }
}
