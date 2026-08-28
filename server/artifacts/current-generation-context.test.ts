import { describe, expect, test } from "bun:test"

import { CurrentGenerationContextResolver } from "../src/artifacts/current-generation-context"
import { PromptTemplateRevisionRegistry } from "../src/prompts/prompt-template-revisions"

describe("current generation context", () => {
  test("resolves provider context through narrow injected sources", () => {
    // Given
    const resolver = new CurrentGenerationContextResolver({
      providers: {
        get: () => ({
          descriptor: {
            id: "fake",
            mode: "test",
            model: { id: "fake-model", displayName: "Fake", maxOutputTokens: 128 },
            capabilities: { generation: true, structuredOutput: true, citedResearch: false }
          },
          enabled: true
        })
      },
      settings: {
        get: () => ({
          selectedModel: "fake-model",
          enabled: true,
          capabilities: { generation: true }
        })
      },
      prompts: new PromptTemplateRevisionRegistry([{ id: "cover-letter", revision: "1" }])
    })

    // When
    const resolution = resolver.resolveProvider("fake")

    // Then
    expect(resolution).toEqual(
      expect.objectContaining({
        kind: "current",
        context: expect.objectContaining({ providerId: "fake", mode: "test", model: "fake-model" })
      })
    )
  })
})
