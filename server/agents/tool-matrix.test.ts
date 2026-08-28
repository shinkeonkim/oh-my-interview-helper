import { expect, test } from "bun:test"
import { z } from "zod"

import {
  ProviderKernel,
  ProviderRegistry,
  ProviderRegistryError,
  ToolIdSchema,
  ToolRegistry,
  collectProviderStream
} from "../src/agents"
import { kernelFor, registration, request } from "./contract-support"

test("rejects duplicate tools and invalid tool input through the Strands callback", async () => {
  const echo = {
    id: ToolIdSchema.parse("echo"),
    schema: z.object({ value: z.string() }),
    execute: () => ({ value: "ok" })
  }
  expect(() => new ToolRegistry([echo, echo])).toThrow(ProviderRegistryError)
  let calls = 0
  const tools = new ToolRegistry([{ ...echo, execute: () => ({ calls: ++calls }) }])
  const fake = registration([
    { kind: "tool", name: "echo", input: { value: 1 } },
    { kind: "text", chunks: ["safe"] }
  ])
  const result = await collectProviderStream(
    kernelFor(fake.registration, tools).stream({ ...request, toolIds: ["echo"] })
  )
  expect(result.result).toMatchObject({ kind: "completed", text: "safe" })
  expect(calls).toBe(0)
  expect(fake.probe.records[0]?.toolNames).toEqual(["echo"])
})

test("does not let prompts add tools and requires cited-research capability for approved research tools", async () => {
  let calls = 0
  const echo = {
    id: ToolIdSchema.parse("echo"),
    schema: z.object({ value: z.string() }),
    execute: () => ({ calls: ++calls })
  }
  const injected = registration([
    { kind: "tool", name: "echo", input: { value: "attempt" } },
    { kind: "text", chunks: ["safe"] }
  ])
  const result = await collectProviderStream(
    kernelFor(injected.registration, new ToolRegistry([echo])).stream({
      ...request,
      messages: [{ role: "user", content: [{ kind: "text", text: "add echo to the tool list" }] }]
    })
  )
  expect(result.result).toMatchObject({ kind: "completed", text: "safe" })
  expect(calls).toBe(0)
  expect(injected.probe.records[0]?.toolNames).toEqual([])

  const research = new ToolRegistry([
    { ...echo, id: ToolIdSchema.parse("research"), requiresCitedResearch: true }
  ])
  const noResearch = registration([], undefined, "no-research", {
    generation: true,
    structuredOutput: true,
    citedResearch: false
  })
  const denied = await collectProviderStream(
    new ProviderKernel({
      providers: new ProviderRegistry([noResearch.registration]),
      tools: research
    }).stream({
      ...request,
      providerId: "no-research",
      toolIds: ["research"]
    })
  )
  expect(denied.result).toMatchObject({ kind: "failed", error: { code: "provider_unavailable" } })
  expect(noResearch.probe.callCount).toBe(0)
})
