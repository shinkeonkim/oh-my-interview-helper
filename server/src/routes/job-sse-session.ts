import type { SSEStreamingApi } from "hono/streaming"

import { isTerminalJobState, type JobEvent } from "../jobs/types"

export type JobSseWriter = Pick<SSEStreamingApi, "write" | "writeSSE">
export type JobSseOverflowSignal = {
  readonly code: "EVENT_REPLAY_REQUIRED"
  readonly lastEventId: string | null
}
type JobSseSessionOptions = {
  readonly initialEventId: string | null
  readonly initialSequence: number
  readonly maxBufferedEvents: number
  readonly onOverflow: (signal: JobSseOverflowSignal) => void
  readonly onStop: () => void
  readonly onTerminal: () => void
}

export class JobSseSession {
  private readonly buffered: JobEvent[] = []
  private readonly pending: JobEvent[] = []
  private lastEventId: string | null
  private latestSequence: number
  private overflowed = false
  private replaying = true
  private stopped = false
  private terminal = false
  private writing = false

  constructor(
    private readonly writer: JobSseWriter,
    private readonly options: JobSseSessionOptions
  ) {
    this.lastEventId = options.initialEventId
    this.latestSequence = options.initialSequence
  }

  get isTerminal(): boolean {
    return this.terminal
  }

  get isStopped(): boolean {
    return this.stopped
  }

  get pendingEventCount(): number {
    return this.buffered.length + this.pending.length
  }

  receive(event: JobEvent): void {
    if (this.terminal || this.overflowed) return
    const target = this.replaying ? this.buffered : this.pending
    if (target.length >= this.options.maxBufferedEvents) {
      this.overflow()
      return
    }
    target.push(event)
    if (!this.replaying) void this.drain()
  }

  async replay(events: readonly JobEvent[]): Promise<void> {
    for (const event of events) {
      if (this.overflowed || this.terminal) return
      await this.writeEvent(event)
    }
    while (this.buffered.length > 0 && !this.overflowed && !this.terminal) {
      const buffered = this.buffered.splice(0).sort((left, right) => left.sequence - right.sequence)
      for (const event of buffered) await this.writeEvent(event)
    }
    this.replaying = false
  }

  async heartbeat(): Promise<void> {
    if (this.overflowed || this.terminal || this.writing || this.pending.length > 0) return
    this.writing = true
    try {
      await this.writer.write(": heartbeat\n\n")
    } finally {
      this.writing = false
    }
  }

  private async drain(): Promise<void> {
    if (this.writing || this.overflowed || this.terminal) return
    this.writing = true
    try {
      while (this.pending.length > 0 && !this.overflowed && !this.terminal) {
        const event = this.pending.shift()
        if (event !== undefined) await this.send(event)
      }
    } finally {
      this.writing = false
    }
  }

  private overflow(): void {
    this.overflowed = true
    this.pending.splice(0)
    this.buffered.splice(0)
    const signal = { code: "EVENT_REPLAY_REQUIRED", lastEventId: this.lastEventId } as const
    this.options.onOverflow(signal)
    if (this.writing) {
      this.stop()
      return
    }
    this.writing = true
    void this.writer
      .writeSSE({ event: "replay_required", data: JSON.stringify(signal) })
      .then(() => {
        this.stop()
      })
  }

  private async writeEvent(event: JobEvent): Promise<void> {
    this.writing = true
    try {
      await this.send(event)
    } finally {
      this.writing = false
    }
  }

  private async send(event: JobEvent): Promise<void> {
    if (event.sequence <= this.latestSequence) return
    this.latestSequence = event.sequence
    await this.writer.writeSSE({ id: event.id, event: event.kind, data: JSON.stringify(event) })
    this.lastEventId = event.id
    if (isTerminalJobState(event.kind)) {
      this.terminal = true
      this.options.onTerminal()
    }
  }

  private stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.options.onStop()
  }
}
