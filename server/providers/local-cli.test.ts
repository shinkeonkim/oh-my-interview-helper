import { describe, expect, test } from "bun:test"

import { localCliCommand } from "../src/providers/local-cli"

describe("automatic local CLI agents", () => {
  test("keeps preparation agents read-only and disables unrelated web tools", () => {
    const claude = localCliCommand("claude-cli", "sonnet")
    const codex = localCliCommand("codex-cli", "gpt-5.4")
    expect(claude).toContain("--restricted")
    expect(claude).toContain("")
    expect(claude).not.toContain("WebSearch")
    expect(codex).toContain("read-only")
    expect(codex).not.toContain("--search")
  })
})
