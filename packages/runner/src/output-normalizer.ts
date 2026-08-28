import { z } from "zod"

export type NormalizedCliEvent =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "usage"
      readonly inputTokens: number
      readonly outputTokens: number
      readonly cacheTokens: number
    }

const ClaudeStreamSchema = z
  .object({
    type: z.literal("stream_event"),
    event: z.object({
      type: z.string(),
      delta: z.object({ type: z.string(), text: z.string().optional() }).passthrough()
    })
  })
  .passthrough()
const ClaudeResultSchema = z
  .object({
    type: z.literal("result"),
    usage: z
      .object({
        input_tokens: z.number().int().nonnegative(),
        output_tokens: z.number().int().nonnegative(),
        cache_read_input_tokens: z.number().int().nonnegative().optional(),
        cache_creation_input_tokens: z.number().int().nonnegative().optional()
      })
      .optional()
  })
  .passthrough()
const CodexMessageSchema = z
  .object({
    type: z.literal("item.completed"),
    item: z.object({ type: z.literal("agent_message"), text: z.string() }).passthrough()
  })
  .passthrough()
const CodexUsageSchema = z
  .object({
    type: z.literal("turn.completed"),
    usage: z.object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
      cached_input_tokens: z.number().int().nonnegative().optional()
    })
  })
  .passthrough()

export const normalizeCliOutputLine = (
  provider: "claude-cli" | "codex-cli",
  line: string
): NormalizedCliEvent | null => {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    throw new CliOutputError("malformed")
  }
  if (provider === "claude-cli") {
    const stream = ClaudeStreamSchema.safeParse(value)
    if (stream.success)
      return stream.data.event.delta.type === "text_delta" &&
        stream.data.event.delta.text !== undefined
        ? { kind: "text", text: stream.data.event.delta.text }
        : null
    const result = ClaudeResultSchema.safeParse(value)
    if (!result.success || result.data.usage === undefined) return null
    const cacheTokens =
      (result.data.usage.cache_read_input_tokens ?? 0) +
      (result.data.usage.cache_creation_input_tokens ?? 0)
    return {
      kind: "usage",
      inputTokens: result.data.usage.input_tokens,
      outputTokens: result.data.usage.output_tokens,
      cacheTokens
    }
  }
  const message = CodexMessageSchema.safeParse(value)
  if (message.success) return { kind: "text", text: message.data.item.text }
  const usage = CodexUsageSchema.safeParse(value)
  return usage.success
    ? {
        kind: "usage",
        inputTokens: usage.data.usage.input_tokens,
        outputTokens: usage.data.usage.output_tokens,
        cacheTokens: usage.data.usage.cached_input_tokens ?? 0
      }
    : null
}

export class CliOutputError extends Error {
  override readonly name = "CliOutputError"
  constructor(readonly code: "malformed") {
    super("CLI_OUTPUT_MALFORMED")
  }
}
