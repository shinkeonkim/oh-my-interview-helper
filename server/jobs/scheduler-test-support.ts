import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPersistence } from "../src/db"
import { JobRuntime, createJobRegistry, type JobDefinition } from "../src/jobs/runtime"
import type { SchedulerClock, SchedulerTimer } from "../src/jobs/scheduler"

type Scheduled = { readonly due: number; readonly callback: () => void }

export class ManualClock implements SchedulerClock {
  private readonly timers = new Map<number, Scheduled>()
  private current = Date.parse("2026-08-26T12:00:00.000Z")
  private sequence = 0

  now = (): Date => new Date(this.current)

  setTimeout = (callback: () => void, milliseconds: number): SchedulerTimer => {
    const id = this.sequence++
    this.timers.set(id, { due: this.current + milliseconds, callback })
    return { cancel: () => this.timers.delete(id) }
  }

  advance(milliseconds: number): void {
    const target = this.current + milliseconds
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.due <= target)
        .sort(([, left], [, right]) => left.due - right.due || 0)[0]
      if (next === undefined) break
      const [id, timer] = next
      this.timers.delete(id)
      this.current = timer.due
      timer.callback()
    }
    this.current = target
  }

  pending(): number {
    return this.timers.size
  }
}

export const barrier = (): { readonly wait: Promise<void>; readonly release: () => void } => {
  let release: (() => void) | undefined
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  return { wait, release: () => release?.() }
}

export const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

export const createHarness = (definitions: readonly JobDefinition[]) => {
  const directory = mkdtempSync(join(tmpdir(), "scheduler-matrix-"))
  const persistence = createPersistence({ dataDirectory: directory })
  return {
    directory,
    persistence,
    runtime: new JobRuntime(persistence.repositories.jobs, createJobRegistry(definitions)),
    close: (): void => {
      persistence.close()
      rmSync(directory, { force: true, recursive: true })
    }
  }
}
