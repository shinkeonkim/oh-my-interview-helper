import type { RunnerClaim } from "./protocol"

export type RunnerCliCapabilities = {
  readonly claudeAuth: "subscription" | "api-key"
  readonly claudeBare: boolean
  readonly codexSkipGitRepoCheck: boolean
}
export type FixedCommand = {
  readonly executable: "claude" | "codex"
  readonly argv: readonly string[]
  readonly stdin: string
  readonly requiresGitInit: boolean
}

export const commandForClaim = (
  claim: RunnerClaim,
  capabilities: RunnerCliCapabilities
): FixedCommand => {
  if (claim.provider === "claude-cli") {
    const bare = capabilities.claudeAuth === "api-key" && capabilities.claudeBare ? ["--bare"] : []
    return {
      executable: "claude",
      argv: [
        ...bare,
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--no-session-persistence",
        "--permission-mode",
        "dontAsk",
        "--model",
        claim.model
      ],
      stdin: claim.prompt,
      requiresGitInit: false
    }
  }
  return {
    executable: "codex",
    argv: [
      "exec",
      "--json",
      "--ephemeral",
      "--sandbox",
      "read-only",
      ...(capabilities.codexSkipGitRepoCheck ? ["--skip-git-repo-check"] : []),
      "--model",
      claim.model,
      "-"
    ],
    stdin: claim.prompt,
    requiresGitInit: true
  }
}
