import {
  Agent,
  MaxTokensError,
  ModelError,
  ModelThrottledError,
  StructuredOutputError,
  TextBlock,
  Message,
  type AgentResult,
  type AgentStreamEvent
} from "@strands-agents/sdk"
import type { ZodType } from "zod"

import {
  InvocationShapeSchema,
  ToolIdSchema,
  type ProviderError,
  type ProviderEvent,
  type ProviderInvocation,
  type ProviderResult,
  type ProviderUsage
} from "./contracts"
import { ProviderRegistryError } from "./registry"
import type { ProviderRegistry, ToolRegistry } from "./registry"
import type { ProviderDescriptor } from "./contracts"
import { terminalCancelled, terminalFailure } from "./kernel-terminal"

export class ProviderKernel {
  constructor(
    private readonly dependencies: {
      readonly providers: ProviderRegistry
      readonly tools: ToolRegistry
    }
  ) {}
  descriptor(id: string): ProviderDescriptor | null {
    return this.dependencies.providers.get(id)?.descriptor ?? null
  }
  async *stream(
    input: ProviderInvocation
  ): AsyncGenerator<ProviderEvent, ProviderResult, undefined> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    try {
      const shape = InvocationShapeSchema.parse({
        providerId: input.providerId,
        messages: input.messages,
        toolIds: input.toolIds,
        ...(input.timeoutMilliseconds === undefined
          ? {}
          : { timeoutMilliseconds: input.timeoutMilliseconds })
      })
      if (input.signal?.aborted) return yield* terminalCancelled(null)
      const provider = this.dependencies.providers.get(shape.providerId)
      yield {
        kind: "started",
        providerId: shape.providerId,
        model: provider?.descriptor.model.id ?? "unavailable"
      }
      if (provider === null) return yield* terminalFailure("provider_unavailable", false, null)
      if (!provider.enabled) return yield* terminalFailure("disabled", false, null)
      if (
        !provider.descriptor.capabilities.generation ||
        (input.output.kind === "structured" && !provider.descriptor.capabilities.structuredOutput)
      )
        return yield* terminalFailure("provider_unavailable", false, null)
      const health = await provider.health()
      if (health.kind === "unavailable")
        return yield* terminalFailure(
          health.code === "disabled" ? "disabled" : "provider_unavailable",
          health.code !== "disabled",
          null
        )
      let tools
      try {
        tools = this.dependencies.tools.select(shape.toolIds)
      } catch (error) {
        if (error instanceof ProviderRegistryError)
          return yield* terminalFailure("tool_denied", false, null)
        throw error
      }
      if (
        !provider.descriptor.capabilities.citedResearch &&
        this.dependencies.tools.requiresCitedResearch(shape.toolIds)
      )
        return yield* terminalFailure("provider_unavailable", false, null)
      const timeout = new AbortController()
      timeoutId = setTimeout(() => timeout.abort("timeout"), input.timeoutMilliseconds ?? 60_000)
      const signal =
        input.signal === undefined
          ? timeout.signal
          : AbortSignal.any([input.signal, timeout.signal])
      const agent = new Agent({
        model: provider.createModel(),
        tools: [...tools],
        printer: false,
        contextManager: false,
        retryStrategy: null,
        toolExecutor: "sequential"
      })
      const structuredToolUses = new Set<string>()
      let structuredFailures = 0
      const messages = shape.messages.map(
        (message) =>
          new Message({
            role: message.role,
            content: message.content.map((block) => new TextBlock(block.text))
          })
      )
      let text = ""
      let usage: ProviderUsage | null = null
      const toolUses = new Map<string, ReturnType<typeof ToolIdSchema.safeParse>["data"]>()
      try {
        const result = yield* consume(agent, messages, input.output, signal, (event) => {
          if (
            event.type === "beforeToolCallEvent" &&
            event.toolUse.name === "strands_structured_output"
          )
            structuredToolUses.add(event.toolUse.toolUseId)
          if (
            event.type === "toolResultEvent" &&
            structuredToolUses.has(event.result.toolUseId) &&
            event.result.status === "error"
          ) {
            structuredFailures += 1
            if (structuredFailures > 1) throw new StructuredRepairLimitError()
          }
          const normalized = normalize(event, toolUses)
          if (normalized?.kind === "text_delta") text += normalized.text
          if (normalized?.kind === "usage") usage = normalized.usage
          return normalized
        })
        if (signal.aborted || result.stopReason === "cancelled") {
          if (timeout.signal.aborted) return yield* terminalFailure("timeout", true, usage)
          const event = { kind: "cancelled", usage, cost: null } as const
          yield event
          return { kind: "cancelled", usage, cost: null }
        }
        const structured =
          input.output.kind === "structured"
            ? (result.structuredOutput ?? parseStructuredText(text, input.output.schema))
            : null
        if (input.output.kind === "structured" && structured === null)
          return yield* terminalFailure("invalid_output", false, usage)
        if (isLimitStopReason(result.stopReason))
          return yield* terminalFailure("limit_exceeded", false, usage)
        yield { kind: "completed", usage, cost: null }
        return { kind: "completed", text, structured, usage, cost: null }
      } catch (error) {
        if (signal.aborted) {
          const code = timeout.signal.aborted ? "timeout" : "cancelled"
          if (code === "cancelled") {
            yield { kind: "cancelled", usage, cost: null }
            return { kind: "cancelled", usage, cost: null }
          }
          return yield* terminalFailure(code, true, usage)
        }
        return yield* terminalFailure(errorCode(error), error instanceof ModelThrottledError, usage)
      }
    } catch (error) {
      return yield* terminalFailure(errorCode(error), false, null)
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId)
    }
  }
}
const consume = async function* (
  agent: Agent,
  messages: readonly Message[],
  output: ProviderInvocation["output"],
  signal: AbortSignal,
  map: (event: AgentStreamEvent) => ProviderEvent | null
): AsyncGenerator<ProviderEvent, AgentResult, undefined> {
  const options = {
    cancelSignal: signal,
    limits: {
      turns: output.kind === "structured" ? 3 : 4,
      outputTokens: 4096,
      totalTokens: 16_384
    },
    ...(output.kind === "structured" ? { structuredOutputSchema: output.schema } : {})
  }
  const stream = agent.stream([...messages], options)
  let next = await stream.next()
  while (!next.done) {
    const event = map(next.value)
    if (event !== null) yield event
    next = await stream.next()
  }
  return next.value
}
const normalize = (
  event: AgentStreamEvent,
  toolUses: Map<string, ReturnType<typeof ToolIdSchema.safeParse>["data"]>
): ProviderEvent | null => {
  switch (event.type) {
    case "modelStreamUpdateEvent":
      switch (event.event.type) {
        case "modelContentBlockDeltaEvent":
          return event.event.delta.type === "textDelta"
            ? { kind: "text_delta", text: event.event.delta.text }
            : null
        case "modelMetadataEvent":
          return event.event.usage === undefined
            ? null
            : { kind: "usage", usage: normalizeUsage(event.event.usage) }
        default:
          return null
      }
    case "beforeToolCallEvent": {
      if (event.toolUse.name === "strands_structured_output") return null
      const parsed = ToolIdSchema.safeParse(event.toolUse.name)
      if (!parsed.success) return null
      toolUses.set(event.toolUse.toolUseId, parsed.data)
      return { kind: "tool_started", toolId: parsed.data }
    }
    case "toolResultEvent": {
      const toolId = toolUses.get(event.result.toolUseId)
      return toolId === undefined
        ? null
        : { kind: "tool_result", toolId, status: event.result.status }
    }
    default:
      return null
  }
}
const normalizeUsage = (usage: {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
}): ProviderUsage => ({
  inputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  cacheTokens:
    "cacheTokens" in usage && typeof usage.cacheTokens === "number" ? usage.cacheTokens : 0,
  totalTokens: usage.totalTokens
})
const errorCode = (error: unknown): ProviderError["code"] => {
  if (error instanceof StructuredRepairLimitError) return "invalid_output"
  if (error instanceof StructuredOutputError) return "invalid_output"
  if (error instanceof MaxTokensError) return "limit_exceeded"
  if (error instanceof ModelThrottledError) return "provider_failure"
  if (error instanceof ModelError) return "provider_failure"
  return "provider_failure"
}
const isLimitStopReason = (reason: string): boolean =>
  reason === "maxTokens" || reason === "modelContextWindowExceeded" || reason.startsWith("limit")
class StructuredRepairLimitError extends Error {
  override readonly name = "StructuredRepairLimitError"
  constructor() {
    super("STRUCTURED_REPAIR_LIMIT")
  }
}

export const parseStructuredText = (text: string, schema: ZodType): unknown | null => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = (fenced ?? text).trim()
  const values = [candidate]
  const start = candidate.indexOf("{")
  const end = candidate.lastIndexOf("}")
  if (start >= 0 && end > start) values.push(candidate.slice(start, end + 1))
  for (const value of values) {
    try {
      const parsed = schema.safeParse(JSON.parse(value))
      if (parsed.success) return parsed.data
    } catch {
      continue
    }
  }
  return null
}
