import { describe, expect, test } from "bun:test"
import { z } from "zod"

import { collectProviderStream, ProviderKernel, ToolRegistry } from "../src/agents"
import {
  createDirectApiProvider,
  loadDirectApiProviderConfig,
  type DirectApiProviderConfig,
  type DirectApiProviderKind
} from "../src/providers"
import { ProviderRegistry } from "../src/agents/registry"

const configured = (value: DirectApiProviderConfig | null): DirectApiProviderConfig => {
  if (value === null) throw new Error("expected configured provider")
  return value
}
const sse = (events: readonly { readonly type: string }[], named: boolean): Response =>
  new Response(
    events
      .map((event) => `${named ? `event: ${event.type}\n` : ""}data: ${JSON.stringify(event)}\n\n`)
      .join(""),
    {
      headers: { "content-type": "text/event-stream" }
    }
  )

const anthropicEvents = [
  {
    type: "message_start",
    message: {
      id: "msg_test",
      type: "message",
      role: "assistant",
      content: [],
      model: "claude-test",
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 3, output_tokens: 0 }
    }
  },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } },
  { type: "content_block_stop", index: 0 },
  {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 2 }
  },
  { type: "message_stop" }
]
const openaiResponse = {
  id: "resp_test",
  object: "response",
  created_at: 1,
  status: "completed",
  error: null,
  incomplete_details: null,
  instructions: null,
  max_output_tokens: 128,
  model: "gpt-test",
  output: [],
  parallel_tool_calls: false,
  previous_response_id: null,
  reasoning: { effort: null, summary: null },
  store: false,
  temperature: 1,
  text: { format: { type: "text" } },
  tool_choice: "auto",
  tools: [],
  top_p: 1,
  truncation: "disabled",
  usage: {
    input_tokens: 4,
    input_tokens_details: { cached_tokens: 1 },
    output_tokens: 2,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 6
  },
  user: null,
  metadata: {}
}
const openaiEvents = [
  { type: "response.created", sequence_number: 0, response: openaiResponse },
  {
    type: "response.output_text.delta",
    sequence_number: 1,
    item_id: "item_test",
    output_index: 0,
    content_index: 0,
    delta: "hello",
    logprobs: []
  },
  { type: "response.completed", sequence_number: 2, response: openaiResponse }
]
const limitedEvents = (kind: DirectApiProviderKind) =>
  kind === "anthropic"
    ? anthropicEvents.map((event) =>
        event.type === "message_delta"
          ? { ...event, delta: { stop_reason: "max_tokens", stop_sequence: null } }
          : event
      )
    : [
        openaiEvents[0],
        {
          type: "response.incomplete",
          sequence_number: 1,
          response: {
            ...openaiResponse,
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" }
          }
        }
      ]
const structuredEvents = (kind: DirectApiProviderKind) =>
  kind === "anthropic"
    ? [
        anthropicEvents[0],
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "tool_test",
            name: "strands_structured_output",
            input: {}
          }
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"answer":"ok"}' }
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "tool_use", stop_sequence: null },
          usage: { output_tokens: 2 }
        },
        { type: "message_stop" }
      ]
    : [
        openaiEvents[0],
        {
          type: "response.output_item.added",
          sequence_number: 1,
          output_index: 0,
          item: {
            type: "function_call",
            id: "item_test",
            call_id: "call_test",
            name: "strands_structured_output",
            arguments: "",
            status: "in_progress"
          }
        },
        {
          type: "response.function_call_arguments.done",
          sequence_number: 2,
          item_id: "item_test",
          output_index: 0,
          arguments: '{"answer":"ok"}'
        },
        { type: "response.completed", sequence_number: 3, response: openaiResponse }
      ]

const provider = (kind: DirectApiProviderKind) => {
  const config = configured(
    loadDirectApiProviderConfig(kind, {
      [`${kind === "anthropic" ? "ANTHROPIC" : "OPENAI"}_API_KEY`]: "canary-key",
      [`${kind === "anthropic" ? "ANTHROPIC" : "OPENAI"}_MODEL`]:
        kind === "anthropic" ? "claude-test" : "gpt-test",
      [`${kind === "anthropic" ? "ANTHROPIC" : "OPENAI"}_BASE_URL`]: "http://localhost:7777"
    })
  )
  return createDirectApiProvider(
    config,
    async () => new Response(null, { status: 200 }),
    async () => sse(kind === "anthropic" ? anthropicEvents : openaiEvents, kind === "anthropic")
  )
}

const providerWithFetch = (kind: DirectApiProviderKind, modelFetch: typeof fetch) => {
  const environmentPrefix = kind === "anthropic" ? "ANTHROPIC" : "OPENAI"
  const config = configured(
    loadDirectApiProviderConfig(kind, {
      [`${environmentPrefix}_API_KEY`]: "canary-key",
      [`${environmentPrefix}_MODEL`]: kind === "anthropic" ? "claude-test" : "gpt-test",
      [`${environmentPrefix}_BASE_URL`]: "http://localhost:7777"
    })
  )
  return createDirectApiProvider(
    config,
    async () => new Response(null, { status: 200 }),
    modelFetch
  )
}

const invoke = async (
  registration: ReturnType<typeof provider>,
  options: {
    readonly signal?: AbortSignal
    readonly timeoutMilliseconds?: number
    readonly structured?: boolean
  } = {}
) =>
  collectProviderStream(
    new ProviderKernel({
      providers: new ProviderRegistry([registration]),
      tools: new ToolRegistry([])
    }).stream({
      providerId: registration.descriptor.id,
      messages: [{ role: "user", content: [{ kind: "text", text: "hello" }] }],
      output: options.structured
        ? { kind: "structured", schema: z.object({ answer: z.string() }) }
        : { kind: "text" },
      toolIds: [],
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.timeoutMilliseconds === undefined
        ? {}
        : { timeoutMilliseconds: options.timeoutMilliseconds })
    })
  )

describe("direct API provider streaming", () => {
  for (const kind of ["anthropic", "openai"] as const) {
    test(`${kind} streams text and normalized nullable-cost usage through Strands`, async () => {
      const registration = provider(kind)
      const result = await invoke(registration)

      expect(result.result).toEqual(
        expect.objectContaining({ kind: "completed", text: "hello", cost: null })
      )
      expect(result.result.usage).toEqual(
        expect.objectContaining({ inputTokens: expect.any(Number), outputTokens: 2 })
      )
    })

    test(`${kind} sanitizes authentication and malformed-stream failures`, async () => {
      const unauthorized = providerWithFetch(
        kind,
        async () =>
          new Response(JSON.stringify({ error: { message: "canary-key invalid" } }), {
            status: 401,
            headers: { "content-type": "application/json" }
          })
      )
      const malformed = providerWithFetch(
        kind,
        async () =>
          new Response("data: {not-json}\n\n", {
            headers: { "content-type": "text/event-stream" }
          })
      )

      const unauthorizedResult = await invoke(unauthorized)
      const malformedResult = await invoke(malformed)
      expect(unauthorizedResult.result).toEqual({
        kind: "failed",
        error: { code: "provider_failure", retryable: false },
        usage: null,
        cost: null
      })
      expect(malformedResult.result.kind).toBe("failed")
      expect(JSON.stringify([unauthorizedResult, malformedResult])).not.toContain("canary-key")
    })

    test(`${kind} normalizes throttling and output limits without fallback`, async () => {
      let throttledCalls = 0
      const throttled = providerWithFetch(kind, async () => {
        throttledCalls += 1
        return new Response(JSON.stringify({ error: { message: "rate limited" } }), {
          status: 429,
          headers: { "content-type": "application/json" }
        })
      })
      const limited = providerWithFetch(kind, async () =>
        sse(limitedEvents(kind), kind === "anthropic")
      )

      expect((await invoke(throttled)).result).toEqual({
        kind: "failed",
        error: { code: "provider_failure", retryable: true },
        usage: null,
        cost: null
      })
      expect(throttledCalls).toBe(1)
      expect((await invoke(limited)).result).toEqual(
        expect.objectContaining({
          kind: "failed",
          error: { code: "limit_exceeded", retryable: false }
        })
      )
    })

    test(`${kind} returns schema-validated structured output through the server tool`, async () => {
      const registration = providerWithFetch(kind, async () =>
        sse(structuredEvents(kind), kind === "anthropic")
      )

      expect((await invoke(registration, { structured: true })).result).toEqual(
        expect.objectContaining({
          kind: "completed",
          structured: { answer: "ok" }
        })
      )
    })

    test(`${kind} propagates cancellation and bounds hanging requests`, async () => {
      const hangingFetch: typeof fetch = (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          if (signal?.aborted) return reject(signal.reason)
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true }
          )
        })
      const registration = providerWithFetch(kind, hangingFetch)
      const aborter = new AbortController()
      const cancelled = invoke(registration, { signal: aborter.signal })
      await Promise.resolve()
      aborter.abort()

      expect((await cancelled).result.kind).toBe("cancelled")
      expect((await invoke(registration, { timeoutMilliseconds: 10 })).result).toEqual({
        kind: "failed",
        error: { code: "timeout", retryable: true },
        usage: null,
        cost: null
      })
    })
  }
})
