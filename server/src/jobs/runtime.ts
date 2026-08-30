import type { JobsRepository } from "./repository"
import {
  CanonicalJobInputSchema,
  assertSecretFreeJobInput,
  isTerminalJobState,
  UnknownJobKindError,
  type ExecutionTarget,
  type Job,
  type JobEvent,
  type JobEventPayload,
  type TerminalJobState
} from "./types"

export type JobHandlerContext = {
  readonly job: Job
  readonly signal: AbortSignal
}
export type JobTerminalContext = {
  readonly job: Job
  readonly state: TerminalJobState
  readonly reason: "succeeded" | "failed" | "timeout" | "cancelled" | "interrupted"
}

export type JobDefinition = {
  readonly kind: string
  readonly retryClass: "local" | "external"
  readonly executionTarget?: ExecutionTarget
  readonly maxAttempts: number
  readonly run: (context: JobHandlerContext) => Promise<void>
  readonly terminal?: (context: JobTerminalContext) => void
  readonly reconcile?: (job: Job) => void
}

export const createJobRegistry = (
  definitions: readonly JobDefinition[]
): Map<string, JobDefinition> => {
  const registry = new Map(definitions.map((definition) => [definition.kind, definition]))
  if (registry.size !== definitions.length) throw new Error("DUPLICATE_JOB_KIND")
  return registry
}

type Subscriber = (event: JobEvent) => void

export class JobRuntime {
  private readonly subscribers = new Map<string, Set<Subscriber>>()
  private readonly aborters = new Map<string, AbortController>()

  constructor(
    readonly repository: JobsRepository,
    readonly registry: Map<string, JobDefinition>
  ) {
    this.repository.onEventCommitted((id) => this.publish(id))
  }

  register(definition: JobDefinition): void {
    if (this.registry.has(definition.kind)) return
    this.registry.set(definition.kind, definition)
  }

  enqueue(input: {
    readonly kind: string
    readonly input: unknown
    readonly idempotencyKey: string
  }): Job {
    const definition = this.registry.get(input.kind)
    if (definition === undefined) throw new UnknownJobKindError(input.kind)
    assertSecretFreeJobInput(input.input)
    const parsed = CanonicalJobInputSchema.parse(input.input)
    const result = this.repository.enqueue({
      id: crypto.randomUUID(),
      kind: definition.kind,
      input: parsed,
      idempotencyKey: input.idempotencyKey,
      retryClass: definition.retryClass,
      executionTarget: definition.executionTarget ?? "app",
      maxAttempts: definition.maxAttempts,
      now: new Date().toISOString()
    })
    return result.job
  }

  cancel(id: string): Job {
    const job = this.repository.cancel({ id, now: new Date().toISOString() }).job
    this.aborters.get(id)?.abort()
    return job
  }

  reportProgress(id: string, payload: JobEventPayload): JobEvent {
    return this.repository.appendProgress({ id, payload, now: new Date().toISOString() })
  }

  subscribe(id: string, subscriber: Subscriber): () => void {
    const subscribers = this.subscribers.get(id) ?? new Set<Subscriber>()
    subscribers.add(subscriber)
    this.subscribers.set(id, subscribers)
    return () => {
      subscribers.delete(subscriber)
      if (subscribers.size === 0) this.subscribers.delete(id)
    }
  }

  publish(id: string): void {
    const events = this.repository.events({ id })
    for (const event of events)
      for (const subscriber of this.subscribers.get(id) ?? []) subscriber(event)
  }

  registerAbortController(id: string, controller: AbortController): void {
    this.aborters.set(id, controller)
  }

  unregisterAbortController(id: string, controller: AbortController): void {
    if (this.aborters.get(id) === controller) this.aborters.delete(id)
  }
  reconcile(job: Job): void {
    if (!isTerminalJobState(job.state)) return
    this.registry.get(job.kind)?.reconcile?.(job)
  }
  reconcileTerminals(): void {
    for (const job of this.repository.list()) this.reconcile(job)
  }
}
