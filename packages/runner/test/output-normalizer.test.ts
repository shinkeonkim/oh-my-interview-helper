import { describe, expect, test } from "bun:test"

import { CliOutputError, normalizeCliOutputLine } from "../src"

describe("CLI stream normalization", () => {
  test("normalizes Claude text deltas and reported usage", () => {
    expect(
      normalizeCliOutputLine(
        "claude-cli",
        JSON.stringify({
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } }
        })
      )
    ).toEqual({ kind: "text", text: "hi" })
    expect(
      normalizeCliOutputLine(
        "claude-cli",
        JSON.stringify({
          type: "result",
          usage: {
            input_tokens: 3,
            output_tokens: 2,
            cache_read_input_tokens: 1,
            cache_creation_input_tokens: 2
          }
        })
      )
    ).toEqual({ kind: "usage", inputTokens: 3, outputTokens: 2, cacheTokens: 3 })
  })

  test("normalizes Codex agent messages and reported usage", () => {
    expect(
      normalizeCliOutputLine(
        "codex-cli",
        JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hi" } })
      )
    ).toEqual({ kind: "text", text: "hi" })
    expect(
      normalizeCliOutputLine(
        "codex-cli",
        JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 4, output_tokens: 2, cached_input_tokens: 1 }
        })
      )
    ).toEqual({ kind: "usage", inputTokens: 4, outputTokens: 2, cacheTokens: 1 })
  })

  test("rejects malformed JSON and ignores non-content events", () => {
    expect(() => normalizeCliOutputLine("codex-cli", "not-json")).toThrow(CliOutputError)
    expect(
      normalizeCliOutputLine("codex-cli", JSON.stringify({ type: "thread.started", id: "x" }))
    ).toBeNull()
  })
})
