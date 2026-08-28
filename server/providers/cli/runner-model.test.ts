import { describe, expect, test } from "bun:test"

import {
  collectProviderStream,
  ProviderKernel,
  ProviderRegistry,
  ToolRegistry
} from "../../src/agents"
import { createCliProvider, type CliProviderId, type CliRunnerTransport } from "../../src/providers"

describe("CLI runner Strands models", () => {
  for (const id of ["claude-cli", "codex-cli"] as const) {
    test(`${id} streams only through its selected runner transport`, async () => {
      const calls: CliProviderId[] = []
      const transport: CliRunnerTransport = {
        connected: (provider) => provider === id,
        stream: async function* (input) {
          calls.push(input.provider)
          yield { kind: "text", text: "hello" }
          yield { kind: "usage", inputTokens: 3, outputTokens: 2, cacheTokens: 1 }
        }
      }
      const registration = createCliProvider({ id, model: "test-model", transport })
      const result = await collectProviderStream(
        new ProviderKernel({
          providers: new ProviderRegistry([registration]),
          tools: new ToolRegistry([])
        }).stream({
          providerId: id,
          messages: [{ role: "user", content: [{ kind: "text", text: "prompt" }] }],
          output: { kind: "text" },
          toolIds: []
        })
      )

      expect(result.result).toEqual(
        expect.objectContaining({
          kind: "completed",
          text: "hello",
          usage: { inputTokens: 3, outputTokens: 2, cacheTokens: 1, totalTokens: 6 }
        })
      )
      expect(calls).toEqual([id])
      expect(await registration.health()).toEqual({ kind: "healthy" })
    })
  }

  test("reports an absent runner without constructing or falling back to another CLI", async () => {
    const transport: CliRunnerTransport = {
      connected: () => false,
      stream: async function* () {
        yield* []
        throw new Error("must not run")
      }
    }
    const registration = createCliProvider({ id: "claude-cli", model: "sonnet", transport })
    expect(await registration.health()).toEqual({ kind: "unavailable", code: "unreachable" })
  })
})
