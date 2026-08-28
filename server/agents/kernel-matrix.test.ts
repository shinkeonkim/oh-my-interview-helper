import { describe, expect, test } from "bun:test"

import { collectProviderStream } from "../src/agents"
import { kernelFor, registration, request, structuredSchema } from "./contract-support"

describe("Strands provider stream matrix", () => {
  test("streams chunked and one-shot text through Agent.stream with nullable usage", async () => {
    const chunked = registration([
      { kind: "text", chunks: ["hel", "lo"], usage: { inputTokens: 3, outputTokens: 2 } }
    ])
    const completed = await collectProviderStream(kernelFor(chunked.registration).stream(request))
    expect(completed.events.map((event) => event.kind)).toEqual([
      "started",
      "text_delta",
      "text_delta",
      "usage",
      "completed"
    ])
    expect(completed.result).toMatchObject({ kind: "completed", text: "hello" })
    expect(chunked.probe.records[0]).toMatchObject({ cancelled: false, toolNames: [] })

    const oneShot = registration([{ kind: "text", chunks: ["complete"] }])
    const withoutUsage = await collectProviderStream(
      kernelFor(oneShot.registration).stream(request)
    )
    expect(withoutUsage.result).toMatchObject({ kind: "completed", text: "complete", usage: null })
    expect(oneShot.probe.callCount).toBe(1)
  })

  test("forces structured output after plain text and keeps the internal tool private", async () => {
    const fake = registration([
      { kind: "text", chunks: ["plain"] },
      { kind: "structured", value: { answer: "forced" } }
    ])
    const completed = await collectProviderStream(
      kernelFor(fake.registration).stream({
        ...request,
        output: { kind: "structured", schema: structuredSchema }
      })
    )
    expect(completed.result).toMatchObject({ kind: "completed", structured: { answer: "forced" } })
    expect(completed.events.map((event) => event.kind)).toEqual([
      "started",
      "text_delta",
      "completed"
    ])
    expect(fake.probe.records.map((record) => record.forcedTool)).toEqual([
      null,
      "strands_structured_output"
    ])
    expect(fake.probe.records[1]?.toolNames).toEqual(["strands_structured_output"])
  })

  test("allows one invalid structured result then one repair, and rejects a second invalid result", async () => {
    const repaired = registration([
      { kind: "structured", value: { answer: 1 } },
      { kind: "structured", value: { answer: "repaired" } }
    ])
    const repairedResult = await collectProviderStream(
      kernelFor(repaired.registration).stream({
        ...request,
        output: { kind: "structured", schema: structuredSchema }
      })
    )
    expect(repairedResult.result).toMatchObject({
      kind: "completed",
      structured: { answer: "repaired" }
    })
    expect(repaired.probe.callCount).toBe(2)

    const forcedRepair = registration([
      { kind: "text", chunks: ["plain"] },
      { kind: "structured", value: { answer: 1 } },
      { kind: "structured", value: { answer: "repaired-after-force" } }
    ])
    const forcedRepairResult = await collectProviderStream(
      kernelFor(forcedRepair.registration).stream({
        ...request,
        output: { kind: "structured", schema: structuredSchema }
      })
    )
    expect(forcedRepairResult.result).toMatchObject({
      kind: "completed",
      structured: { answer: "repaired-after-force" }
    })
    expect(forcedRepair.probe.callCount).toBe(3)

    const invalid = registration([
      { kind: "structured", value: { answer: 1 } },
      { kind: "structured", value: { answer: 2 } },
      { kind: "structured", value: { answer: "must-not-run" } }
    ])
    const invalidResult = await collectProviderStream(
      kernelFor(invalid.registration).stream({
        ...request,
        output: { kind: "structured", schema: structuredSchema }
      })
    )
    expect(invalidResult.result).toMatchObject({
      kind: "failed",
      error: { code: "invalid_output" }
    })
    expect(invalid.probe.callCount).toBe(2)
  })

  test("maps malformed events, provider throws, and model limits to sanitized terminal failures", async () => {
    const malformed = await collectProviderStream(
      kernelFor(registration([{ kind: "out_of_order" }]).registration).stream(request)
    )
    expect(malformed.result).toMatchObject({ kind: "failed", error: { code: "provider_failure" } })

    const secret = "api-key-should-not-escape"
    const thrown = await collectProviderStream(
      kernelFor(registration([{ kind: "failure", message: secret }]).registration).stream(request)
    )
    expect(JSON.stringify(thrown)).not.toContain(secret)
    expect(thrown.result).toMatchObject({ kind: "failed", error: { code: "provider_failure" } })

    const limited = await collectProviderStream(
      kernelFor(
        registration([{ kind: "text", chunks: ["partial"], stopReason: "maxTokens" }]).registration
      ).stream(request)
    )
    expect(limited.result).toMatchObject({ kind: "failed", error: { code: "limit_exceeded" } })
  })
})
