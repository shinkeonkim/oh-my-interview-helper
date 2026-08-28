import { expect, test } from "bun:test"

import {
  ProviderDescriptorSchema,
  ProviderKernel,
  ProviderRegistry,
  ProviderRegistryError,
  ToolIdSchema,
  ToolRegistry,
  collectProviderStream
} from "../src/agents"
import { kernelFor, registration, request, structuredSchema } from "./contract-support"

test("rejects duplicate IDs and reports unconfigured, disabled, and unreachable health", async () => {
  const first = registration([{ kind: "text", chunks: ["first"] }])
  const duplicate = registration([{ kind: "text", chunks: ["second"] }])
  expect(() => new ProviderRegistry([first.registration, duplicate.registration])).toThrow(
    ProviderRegistryError
  )
  const disabled = registration([], undefined, "disabled", undefined, false)
  const unreachable = registration([], undefined, "remote", undefined, true, async () => ({
    kind: "unavailable" as const,
    code: "unreachable" as const
  }))
  const registry = new ProviderRegistry([disabled.registration, unreachable.registration])
  expect(await registry.health("unknown")).toEqual({ kind: "unavailable", code: "unconfigured" })
  expect(await registry.health("disabled")).toEqual({ kind: "unavailable", code: "disabled" })
  expect(await registry.health("remote")).toEqual({ kind: "unavailable", code: "unreachable" })
})

test("enforces descriptor capabilities and never constructs an unselected fallback", async () => {
  const noGeneration = registration([], undefined, "generation-off", {
    generation: false,
    structuredOutput: true,
    citedResearch: true
  })
  const generationResult = await collectProviderStream(
    kernelFor(noGeneration.registration).stream({
      ...request,
      providerId: "generation-off"
    })
  )
  expect(generationResult.result).toMatchObject({
    kind: "failed",
    error: { code: "provider_unavailable" }
  })

  const noStructured = registration([], undefined, "structured-off", {
    generation: true,
    structuredOutput: false,
    citedResearch: true
  })
  const structuredResult = await collectProviderStream(
    kernelFor(noStructured.registration).stream({
      ...request,
      providerId: "structured-off",
      output: { kind: "structured", schema: structuredSchema }
    })
  )
  expect(structuredResult.result).toMatchObject({
    kind: "failed",
    error: { code: "provider_unavailable" }
  })

  const selected = registration([{ kind: "failure" }], undefined, "selected")
  const fallback = registration([{ kind: "text", chunks: ["fallback"] }], undefined, "fallback")
  const result = await collectProviderStream(
    new ProviderKernel({
      providers: new ProviderRegistry([selected.registration, fallback.registration]),
      tools: new ToolRegistry([])
    }).stream({ ...request, providerId: "selected" })
  )
  expect(result.result).toMatchObject({ kind: "failed", error: { code: "provider_failure" } })
  expect(selected.probe.callCount).toBe(1)
  expect(fallback.probe.callCount).toBe(0)
})

test("denies unknown tools before model construction and keeps descriptors secret-free", async () => {
  const fake = registration([{ kind: "text", chunks: ["never"] }])
  const denied = await collectProviderStream(
    kernelFor(fake.registration).stream({ ...request, toolIds: ["unknown-tool"] })
  )
  expect(denied.result).toMatchObject({ kind: "failed", error: { code: "tool_denied" } })
  expect(fake.probe.callCount).toBe(0)
  expect(
    ProviderDescriptorSchema.safeParse({
      ...fake.registration.descriptor,
      apiKey: "forbidden"
    }).success
  ).toBe(false)
  expect(ToolIdSchema.safeParse("bash").success).toBe(true)
})
