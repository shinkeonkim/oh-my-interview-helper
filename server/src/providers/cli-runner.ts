import {
  Model,
  type BaseModelConfig,
  type Message,
  type ModelStreamEvent,
  type StreamOptions
} from "@strands-agents/sdk"

import { ProviderIdSchema } from "../agents/contracts"
import type { ProviderRegistration } from "../agents/registry"

export type CliProviderId = "claude-cli" | "codex-cli"
export type CliTransportEvent =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "usage"
      readonly inputTokens: number
      readonly outputTokens: number
      readonly cacheTokens: number
    }
export type CliRunnerTransport = {
  readonly connected: (provider: CliProviderId) => boolean
  readonly stream: (input: {
    readonly provider: CliProviderId
    readonly model: string
    readonly prompt: string
    readonly signal?: AbortSignal
  }) => AsyncIterable<CliTransportEvent>
}

type CliModelConfig = BaseModelConfig & { readonly modelId: string }

class CliRunnerModel extends Model<CliModelConfig> {
  private config: CliModelConfig

  constructor(
    private readonly provider: CliProviderId,
    model: string,
    private readonly transport: CliRunnerTransport
  ) {
    super()
    this.config = { modelId: model }
  }

  updateConfig(config: CliModelConfig): void {
    this.config = { ...config, modelId: this.config.modelId }
  }

  getConfig(): CliModelConfig {
    return this.config
  }

  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    yield { type: "modelMessageStartEvent", role: "assistant" }
    yield { type: "modelContentBlockStartEvent" }
    let usage: Extract<CliTransportEvent, { readonly kind: "usage" }> | null = null
    for await (const event of this.transport.stream({
      provider: this.provider,
      model: this.config.modelId,
      prompt: messages
        .flatMap((message) => message.content)
        .flatMap((block) => (block.type === "textBlock" ? [block.text] : []))
        .join("\n"),
      ...(options?.cancelSignal === undefined ? {} : { signal: options.cancelSignal })
    })) {
      if (event.kind === "text")
        yield {
          type: "modelContentBlockDeltaEvent",
          delta: { type: "textDelta", text: event.text }
        }
      else usage = event
    }
    yield { type: "modelContentBlockStopEvent" }
    if (usage !== null)
      yield {
        type: "modelMetadataEvent",
        usage: {
          ...usage,
          totalTokens: usage.inputTokens + usage.outputTokens + usage.cacheTokens
        }
      }
    yield { type: "modelMessageStopEvent", stopReason: "endTurn" }
  }
}

export const createCliProvider = (input: {
  readonly id: CliProviderId
  readonly model: string
  readonly transport: CliRunnerTransport
}): ProviderRegistration => ({
  descriptor: {
    id: ProviderIdSchema.parse(input.id),
    mode: "runner",
    model: { id: input.model, displayName: input.model, maxOutputTokens: 8_192 },
    capabilities: { generation: true, structuredOutput: true, citedResearch: true }
  },
  enabled: true,
  createModel: () => new CliRunnerModel(input.id, input.model, input.transport),
  health: async () =>
    input.transport.connected(input.id)
      ? { kind: "healthy" }
      : { kind: "unavailable", code: "unreachable" }
})
