import { expect, test } from "bun:test"

import {
  ProviderKernel,
  ProviderRegistry,
  ToolRegistry,
  collectProviderStream
} from "../src/agents"
import { kernelFor, registration, request } from "./contract-support"

type PreflightCase = {
  readonly name: string
  readonly kernel: ProviderKernel
  readonly invocation: typeof request
  readonly code: string
  readonly secret: string
}

test("emits started and one sanitized terminal for every preflight rejection", async () => {
  // Given
  const healthy = registration([{ kind: "text", chunks: ["unused"] }])
  const healthSecret = "HEALTH_SECRET"
  const modelSecret = "MODEL_SECRET"
  const disabled = registration([], undefined, "disabled", undefined, false)
  const unavailable = registration([], undefined, "unavailable", undefined, true, async () => ({
    kind: "unavailable" as const,
    code: "unreachable" as const
  }))
  const noGeneration = registration([], undefined, "no-generation", {
    generation: false,
    structuredOutput: true,
    citedResearch: false
  })
  const cases: readonly PreflightCase[] = [
    {
      name: "unknown provider",
      kernel: new ProviderKernel({
        providers: new ProviderRegistry([]),
        tools: new ToolRegistry([])
      }),
      invocation: request,
      code: "provider_unavailable",
      secret: "UNKNOWN_SECRET"
    },
    {
      name: "disabled provider",
      kernel: kernelFor(disabled.registration),
      invocation: { ...request, providerId: "disabled" },
      code: "disabled",
      secret: "DISABLED_SECRET"
    },
    {
      name: "unavailable provider",
      kernel: kernelFor(unavailable.registration),
      invocation: { ...request, providerId: "unavailable" },
      code: "provider_unavailable",
      secret: "UNAVAILABLE_SECRET"
    },
    {
      name: "capability mismatch",
      kernel: kernelFor(noGeneration.registration),
      invocation: { ...request, providerId: "no-generation" },
      code: "provider_unavailable",
      secret: "CAPABILITY_SECRET"
    },
    {
      name: "unknown tool",
      kernel: kernelFor(healthy.registration),
      invocation: { ...request, toolIds: ["unknown-tool"] },
      code: "tool_denied",
      secret: "TOOL_SECRET"
    },
    {
      name: "throwing health",
      kernel: kernelFor({
        ...healthy.registration,
        health: async () => Promise.reject(new Error(healthSecret))
      }),
      invocation: request,
      code: "provider_failure",
      secret: healthSecret
    },
    {
      name: "throwing model factory",
      kernel: kernelFor({
        ...healthy.registration,
        createModel: () => {
          throw new Error(modelSecret)
        }
      }),
      invocation: request,
      code: "provider_failure",
      secret: modelSecret
    }
  ]

  // When / Then
  for (const scenario of cases) {
    const completed = await collectProviderStream(scenario.kernel.stream(scenario.invocation))
    expect(
      completed.events.map((event) => event.kind),
      scenario.name
    ).toEqual(["started", "failed"])
    expect(completed.result).toMatchObject({ kind: "failed", error: { code: scenario.code } })
    expect(JSON.stringify(completed), scenario.name).not.toContain(scenario.secret)
  }
})
