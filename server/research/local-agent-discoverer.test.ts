import { describe, expect, test } from "bun:test"

import { researchDiscoveryCommand } from "../src/research/local-agent-discoverer"

describe("local research source discovery", () => {
  test("explicitly permits only Claude web search and fetch tools", () => {
    const command = researchDiscoveryCommand("claude")

    expect(command).toContain("--restricted")
    expect(command.slice(command.indexOf("--tools"), command.indexOf("--model"))).toEqual([
      "--tools",
      "WebSearch,WebFetch",
      "--allowedTools",
      "WebSearch,WebFetch"
    ])
  })
})
