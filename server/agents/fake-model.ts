import {
  Model,
  ModelContentBlockDeltaEvent,
  ModelContentBlockStartEvent,
  ModelContentBlockStopEvent,
  ModelMessageStartEvent,
  ModelMessageStopEvent,
  ModelMetadataEvent,
  type BaseModelConfig,
  type Message,
  type ModelStreamEvent,
  type StreamOptions
} from "@strands-agents/sdk"

export type FakeModelStep =
  | {
      readonly kind: "text"
      readonly chunks: readonly string[]
      readonly usage?: {
        readonly inputTokens: number
        readonly outputTokens: number
        readonly cacheTokens?: number
      }
      readonly stopReason?: "endTurn" | "limitTurns" | "maxTokens"
    }
  | { readonly kind: "tool"; readonly name: string; readonly input: unknown }
  | { readonly kind: "structured"; readonly value: unknown }
  | { readonly kind: "failure"; readonly message?: string }
  | { readonly kind: "hang" }
  | { readonly kind: "out_of_order" }
export type FakeModelCall = {
  readonly toolNames: readonly string[]
  readonly forcedTool: string | null
  readonly cancelled: boolean
}
export class FakeModelProbe {
  private readonly calls: FakeModelCall[] = []
  private readonly waiters: Array<{ readonly count: number; readonly resolve: () => void }> = []
  record(call: FakeModelCall): void {
    this.calls.push(call)
    for (const waiter of this.waiters.splice(0)) {
      if (this.calls.length >= waiter.count) waiter.resolve()
      else this.waiters.push(waiter)
    }
  }
  get callCount(): number {
    return this.calls.length
  }
  get records(): readonly FakeModelCall[] {
    return this.calls
  }
  waitForCalls(count: number): Promise<void> {
    if (this.calls.length >= count) return Promise.resolve()
    return new Promise((resolve) => this.waiters.push({ count, resolve }))
  }
}
export type FakeModelConfig = BaseModelConfig & {
  readonly steps: readonly FakeModelStep[]
  readonly probe?: FakeModelProbe
}

export class FakeModel extends Model<FakeModelConfig> {
  private config: FakeModelConfig
  private cursor = 0
  constructor(config: FakeModelConfig) {
    super()
    this.config = config
  }
  updateConfig(config: FakeModelConfig): void {
    this.config = { ...this.config, ...config }
  }
  getConfig(): FakeModelConfig {
    return this.config
  }
  async *stream(_messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    const step = this.config.steps[this.cursor++]
    if (step === undefined) throw new FakeModelError()
    this.config.probe?.record({
      toolNames: options?.toolSpecs?.map((spec) => spec.name) ?? [],
      forcedTool: forcedToolName(options),
      cancelled: options?.cancelSignal?.aborted ?? false
    })
    if (step.kind === "hang") {
      await new Promise<void>((resolve) =>
        options?.cancelSignal?.addEventListener("abort", () => resolve(), { once: true })
      )
      return
    }
    if (step.kind === "failure") throw new FakeModelError(step.message)
    if (step.kind === "out_of_order") {
      yield new ModelContentBlockDeltaEvent({
        type: "modelContentBlockDeltaEvent",
        delta: { type: "textDelta", text: "invalid" }
      })
      yield new ModelMessageStopEvent({ type: "modelMessageStopEvent", stopReason: "endTurn" })
      return
    }
    yield new ModelMessageStartEvent({ type: "modelMessageStartEvent", role: "assistant" })
    if (step.kind === "text") {
      yield new ModelContentBlockStartEvent({ type: "modelContentBlockStartEvent" })
      for (const text of step.chunks)
        yield new ModelContentBlockDeltaEvent({
          type: "modelContentBlockDeltaEvent",
          delta: { type: "textDelta", text }
        })
      yield new ModelContentBlockStopEvent({ type: "modelContentBlockStopEvent" })
      yield new ModelMessageStopEvent({
        type: "modelMessageStopEvent",
        stopReason: step.stopReason ?? "endTurn"
      })
      if (step.usage !== undefined) yield metadata(step.usage)
      return
    }
    const name = step.kind === "structured" ? "strands_structured_output" : step.name
    const input = step.kind === "structured" ? step.value : step.input
    const toolUseId = `fake-${this.cursor}`
    yield new ModelContentBlockStartEvent({
      type: "modelContentBlockStartEvent",
      start: { type: "toolUseStart", name, toolUseId }
    })
    yield new ModelContentBlockDeltaEvent({
      type: "modelContentBlockDeltaEvent",
      delta: { type: "toolUseInputDelta", input: JSON.stringify(input) }
    })
    yield new ModelContentBlockStopEvent({ type: "modelContentBlockStopEvent" })
    yield new ModelMessageStopEvent({ type: "modelMessageStopEvent", stopReason: "toolUse" })
  }
}
const metadata = (usage: {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheTokens?: number
}): ModelMetadataEvent =>
  new ModelMetadataEvent({
    type: "modelMetadataEvent",
    usage: {
      ...usage,
      cacheTokens: usage.cacheTokens ?? 0,
      totalTokens: usage.inputTokens + usage.outputTokens + (usage.cacheTokens ?? 0)
    },
    metrics: { latencyMs: 1 }
  })
export class FakeModelError extends Error {
  override readonly name = "FakeModelError"
  constructor(message = "FAKE_PROVIDER_FAILURE") {
    super(message)
  }
}
const forcedToolName = (options: StreamOptions | undefined): string | null => {
  const choice = options?.toolChoice
  if (choice !== undefined && "tool" in choice) return choice.tool.name
  return null
}
