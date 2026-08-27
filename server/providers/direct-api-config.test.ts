import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Model } from "@strands-agents/sdk"

import {
  DirectApiConfigurationError,
  createDirectApiProvider,
  createDirectApiProviderRegistry,
  loadDirectApiProviderConfig,
  type DirectApiProviderConfig
} from "../src/providers"

const configured = (value: DirectApiProviderConfig | null): DirectApiProviderConfig => {
  if (value === null) throw new Error("expected configured provider")
  return value
}

describe("direct API provider configuration", () => {
  test("loads independent environment and secret-file credentials without exposing them", () => {
    const directory = mkdtempSync(join(tmpdir(), "direct-provider-config-"))
    const keyFile = join(directory, "openai-key")
    writeFileSync(keyFile, "openai-canary\n", { mode: 0o600 })
    try {
      const anthropic = loadDirectApiProviderConfig("anthropic", {
        ANTHROPIC_API_KEY: "anthropic-canary",
        ANTHROPIC_MODEL: "claude-test",
        ANTHROPIC_ALLOWED_MODELS: "claude-test"
      })
      const openai = loadDirectApiProviderConfig("openai", {
        OPENAI_API_KEY_FILE: keyFile,
        OPENAI_MODEL: "gpt-test",
        OPENAI_ALLOWED_MODELS: "gpt-test"
      })

      expect(anthropic?.apiKey).toBe("anthropic-canary")
      expect(openai?.apiKey).toBe("openai-canary")
      expect(JSON.stringify(createDirectApiProvider(configured(anthropic)))).not.toContain(
        "anthropic-canary"
      )
      expect(JSON.stringify(createDirectApiProvider(configured(openai)))).not.toContain(
        "openai-canary"
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("constructs explicit Strands models and never falls back across providers", () => {
    const anthropic = configured(
      loadDirectApiProviderConfig("anthropic", {
        ANTHROPIC_API_KEY: "key",
        ANTHROPIC_MODEL: "claude-test",
        ANTHROPIC_ALLOWED_MODELS: "claude-test"
      })
    )
    const openai = configured(
      loadDirectApiProviderConfig("openai", {
        OPENAI_API_KEY: "key",
        OPENAI_MODEL: "gpt-test",
        OPENAI_ALLOWED_MODELS: "gpt-test"
      })
    )

    expect(createDirectApiProvider(anthropic).createModel()).toBeInstanceOf(Model)
    expect(createDirectApiProvider(openai).createModel()).toBeInstanceOf(Model)
    expect(createDirectApiProvider(anthropic).descriptor.id).toBe("anthropic-api")
    expect(createDirectApiProvider(openai).descriptor.id).toBe("openai-api")
  })

  test("leaves providers independently unconfigured and rejects ambiguous or denied settings", () => {
    expect(loadDirectApiProviderConfig("anthropic", { OPENAI_API_KEY: "key" })).toBeNull()
    expect(() =>
      loadDirectApiProviderConfig("openai", {
        OPENAI_API_KEY: "key",
        OPENAI_API_KEY_FILE: "/not/read",
        OPENAI_MODEL: "gpt-test"
      })
    ).toThrow(DirectApiConfigurationError)
    expect(() =>
      loadDirectApiProviderConfig("openai", {
        OPENAI_API_KEY: "key",
        OPENAI_MODEL: "gpt-denied",
        OPENAI_ALLOWED_MODELS: "gpt-allowed"
      })
    ).toThrow("DIRECT_API_CONFIGURATION_ERROR: openai:model_denied")
  })

  test("registers either provider without requiring or falling back to the other", () => {
    const registry = createDirectApiProviderRegistry({
      OPENAI_API_KEY: "key",
      OPENAI_MODEL: "gpt-test"
    })

    expect(registry.get("openai-api")?.descriptor.model.id).toBe("gpt-test")
    expect(registry.get("anthropic-api")).toBeNull()
  })

  test("normalizes health failures without returning vendor error bodies or keys", async () => {
    const config = configured(
      loadDirectApiProviderConfig("anthropic", {
        ANTHROPIC_API_KEY: "canary-secret",
        ANTHROPIC_MODEL: "claude-test"
      })
    )
    const provider = createDirectApiProvider(
      config,
      async () => new Response('{"error":"canary-secret"}', { status: 401 })
    )

    expect(await provider.health()).toEqual({ kind: "unavailable", code: "unreachable" })
    expect(JSON.stringify(await provider.health())).not.toContain("canary-secret")
  })
})
