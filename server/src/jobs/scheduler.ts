import type { JobRuntime } from "./runtime"
import { systemSchedulerClock, type SchedulerClock, type SchedulerTimer } from "./scheduler-clock"
import { runHandler } from "./scheduler-handler"
import { reconcile, terminalize } from "./scheduler-terminalizer"
import { JobTransitionError, type Job } from "./types"

export { type SchedulerClock } from "./scheduler-clock"

export type JobSchedulerOptions = {
  readonly concurrency?: number
  readonly idleMilliseconds?: number
  readonly leaseMilliseconds?: number
  readonly heartbeatMilliseconds?: number
  readonly handlerTimeoutMilliseconds?: number
  readonly shutdownGraceMilliseconds?: number
  readonly owner?: string
  readonly clock?: SchedulerClock
}

type ActiveJob = {
  readonly id: string
  readonly controller: AbortController
  done: Promise<void>
  heartbeat: SchedulerTimer | null
  timeout: SchedulerTimer | null
  finalized: boolean
}

export class JobScheduler {
  private readonly active = new Map<string, ActiveJob>()
  private readonly clock: SchedulerClock
  private readonly concurrency: number
  private readonly heartbeatMilliseconds: number
  private readonly handlerTimeoutMilliseconds: number
  private readonly idleMilliseconds: number
  private readonly leaseMilliseconds: number
  private readonly owner: string
  private readonly shutdownGraceMilliseconds: number
  private idleTimer: SchedulerTimer | null = null
  private stopped = true

  constructor(
    private readonly runtime: JobRuntime,
    options: JobSchedulerOptions = {}
  ) {
    this.clock = options.clock ?? systemSchedulerClock
    this.concurrency = options.concurrency ?? 2
    this.idleMilliseconds = options.idleMilliseconds ?? 500
    this.leaseMilliseconds = options.leaseMilliseconds ?? 30_000
    this.heartbeatMilliseconds =
      options.heartbeatMilliseconds ?? Math.max(1, Math.floor(this.leaseMilliseconds / 3))
    this.handlerTimeoutMilliseconds = options.handlerTimeoutMilliseconds ?? 60_000
    this.shutdownGraceMilliseconds = options.shutdownGraceMilliseconds ?? 5_000
    this.owner = options.owner ?? crypto.randomUUID()
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    reconcile(this.runtime, this.now())
    this.runtime.reconcileTerminals()
    this.wake()
  }

  wake(): void {
    if (this.stopped) return
    this.idleTimer?.cancel()
    this.idleTimer = null
    this.pump()
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.idleTimer?.cancel()
    this.idleTimer = null
    const active = [...this.active.values()]
    if (active.length === 0) return
    await this.waitForGrace(active)
    for (const job of [...this.active.values()]) this.forceInterrupt(job)
  }

  private pump(): void {
    reconcile(this.runtime, this.now())
    while (!this.stopped && this.active.size < this.concurrency) {
      try {
        const job = this.runtime.repository.claim({
          owner: this.owner,
          now: this.now(),
          leaseMilliseconds: this.leaseMilliseconds
        }).job
        this.launch(job)
      } catch (error) {
        if (error instanceof JobTransitionError && error.code === "JOB_NOT_CLAIMABLE") {
          this.idleTimer = this.clock.setTimeout(() => this.wake(), this.idleMilliseconds)
          return
        }
        throw error
      }
    }
  }

  private launch(job: Job): void {
    const active: ActiveJob = {
      id: job.id,
      controller: new AbortController(),
      done: Promise.resolve(),
      heartbeat: null,
      timeout: null,
      finalized: false
    }
    this.active.set(job.id, active)
    active.done = this.execute(active)
    void active.done.then(() => {
      if (!this.stopped) this.wake()
    })
  }

  private async execute(active: ActiveJob): Promise<void> {
    let started: Job | null = null
    try {
      const job = this.runtime.repository.start({
        id: active.id,
        owner: this.owner,
        now: this.now()
      }).job
      started = job
      const definition = this.runtime.registry.get(job.kind)
      if (definition === undefined) {
        this.runtime.repository.fail({
          id: job.id,
          owner: this.owner,
          now: this.now(),
          code: "handler_missing",
          message: "Job handler is unavailable"
        })
        return
      }
      this.runtime.registerAbortController(job.id, active.controller)
      this.scheduleHeartbeat(active)
      active.timeout = this.clock.setTimeout(
        () => active.controller.abort("timeout"),
        this.handlerTimeoutMilliseconds
      )
      const result = await runHandler(
        definition.run({ job, signal: active.controller.signal }),
        active.controller.signal
      )
      if (active.finalized) return
      switch (result.kind) {
        case "succeeded":
          if (active.controller.signal.aborted) {
            if (active.controller.signal.reason === "timeout")
              terminalize(this.runtime, definition, job, this.owner, this.now(), "timeout", {
                kind: "fail",
                code: "handler_timeout",
                message: "Job handler timed out"
              })
            else if (active.controller.signal.reason === "shutdown")
              terminalize(this.runtime, definition, job, this.owner, this.now(), "interrupted", {
                kind: "interrupt"
              })
            else if (active.controller.signal.reason !== "lost_lease")
              terminalize(this.runtime, definition, job, this.owner, this.now(), "cancelled", {
                kind: "cancel"
              })
            return
          }
          terminalize(this.runtime, definition, job, this.owner, this.now(), "succeeded", {
            kind: "succeed"
          })
          return
        case "failed":
          terminalize(this.runtime, definition, job, this.owner, this.now(), "failed", {
            kind: "fail",
            code: "handler_failed",
            message: "Job handler failed"
          })
          return
        case "aborted":
          if (result.reason === "timeout")
            terminalize(this.runtime, definition, job, this.owner, this.now(), "timeout", {
              kind: "fail",
              code: "handler_timeout",
              message: "Job handler timed out"
            })
          else if (result.reason !== "shutdown" && result.reason !== "lost_lease")
            terminalize(this.runtime, definition, job, this.owner, this.now(), "cancelled", {
              kind: "cancel"
            })
      }
    } catch (error) {
      if (error instanceof JobTransitionError || started === null) return
      const definition = this.runtime.registry.get(started.kind)
      if (definition === undefined) return
      terminalize(this.runtime, definition, started, this.owner, this.now(), "failed", {
        kind: "fail",
        code: "handler_failed",
        message: "Job handler failed"
      })
    } finally {
      this.finalize(active)
    }
  }

  private scheduleHeartbeat(active: ActiveJob): void {
    active.heartbeat = this.clock.setTimeout(() => {
      if (active.finalized) return
      try {
        this.runtime.repository.heartbeat({
          id: active.id,
          owner: this.owner,
          now: this.now(),
          leaseMilliseconds: this.leaseMilliseconds
        })
        this.scheduleHeartbeat(active)
      } catch (error) {
        if (!(error instanceof JobTransitionError)) throw error
        active.controller.abort("lost_lease")
      }
    }, this.heartbeatMilliseconds)
  }

  private async waitForGrace(active: readonly ActiveJob[]): Promise<void> {
    let resolveDeadline: () => void = () => undefined
    const deadline = new Promise<void>((resolve) => {
      resolveDeadline = resolve
    })
    const grace = this.clock.setTimeout(resolveDeadline, this.shutdownGraceMilliseconds)
    await Promise.race([Promise.all(active.map((job) => job.done)), deadline])
    grace.cancel()
  }

  private forceInterrupt(active: ActiveJob): void {
    active.controller.abort("shutdown")
    try {
      const job = this.runtime.repository.get({ id: active.id })
      const definition = job === null ? undefined : this.runtime.registry.get(job.kind)
      if (job === null || definition === undefined) throw new JobTransitionError("JOB_NOT_FOUND")
      terminalize(this.runtime, definition, job, this.owner, this.now(), "interrupted", {
        kind: "interrupt"
      })
    } catch (error) {
      if (!(error instanceof JobTransitionError)) throw error
    }
    this.finalize(active)
  }

  private finalize(active: ActiveJob): void {
    if (active.finalized) return
    active.finalized = true
    active.heartbeat?.cancel()
    active.timeout?.cancel()
    this.runtime.unregisterAbortController(active.id, active.controller)
    this.active.delete(active.id)
    this.runtime.publish(active.id)
  }

  private now(): string {
    return this.clock.now().toISOString()
  }
}
