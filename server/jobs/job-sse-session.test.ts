import { expect, test } from "bun:test"

import { JobSseSession, type JobSseWriter } from "../src/routes/job-sse-session"
import type { JobEvent } from "../src/jobs/types"

const barrier = (): { readonly wait: Promise<void>; readonly release: () => void } => {
  let release: (() => void) | undefined
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  return { wait, release: () => release?.() }
}

const event = (sequence: number): JobEvent => ({
  id: crypto.randomUUID(),
  jobId: crypto.randomUUID(),
  sequence,
  kind: "progress",
  payload: { sequence },
  createdAt: "2026-08-26T12:00:00.000Z"
})

test("bounds blocked subscriber queues and reports replay-required overflow without chaining writes", async () => {
  // Given
  const firstWrite = barrier()
  const releaseWrite = barrier()
  const written: string[] = []
  let heartbeats = 0
  let overflow: { readonly code: string; readonly lastEventId: string | null } | null = null
  let stopped = 0
  const writer: JobSseWriter = {
    write: async () => {
      heartbeats++
    },
    writeSSE: async (message) => {
      written.push(message.id ?? "overflow")
      firstWrite.release()
      await releaseWrite.wait
    }
  }
  const session = new JobSseSession(writer, {
    initialEventId: null,
    initialSequence: 0,
    maxBufferedEvents: 2,
    onOverflow: (signal) => {
      overflow = signal
    },
    onStop: () => {
      stopped++
    }
  })
  await session.replay([])

  // When
  session.receive(event(1))
  await firstWrite.wait
  await session.heartbeat()
  session.receive(event(2))
  session.receive(event(3))
  session.receive(event(4))

  // Then
  expect(session.pendingEventCount).toBeLessThanOrEqual(2)
  expect(overflow).toEqual({ code: "EVENT_REPLAY_REQUIRED", lastEventId: null })
  expect(stopped).toBe(1)
  expect(written).toHaveLength(1)
  expect(heartbeats).toBe(0)
  releaseWrite.release()
})

test("writes a typed replay-required frame when overflow occurs without an active writer", async () => {
  // Given
  const messages: { readonly event: string | undefined; readonly data: string }[] = []
  const writer: JobSseWriter = {
    write: async () => undefined,
    writeSSE: async (message) => {
      messages.push({ event: message.event, data: await message.data })
    }
  }
  const session = new JobSseSession(writer, {
    initialEventId: null,
    initialSequence: 0,
    maxBufferedEvents: 0,
    onOverflow: () => undefined,
    onStop: () => undefined,
    onTerminal: () => undefined
  })
  await session.replay([])

  // When
  session.receive(event(1))
  await Promise.resolve()

  // Then
  expect(messages).toEqual([
    { event: "replay_required", data: '{"code":"EVENT_REPLAY_REQUIRED","lastEventId":null}' }
  ])
})

test("does not re-send events at or before the acknowledged replay cursor", async () => {
  // Given
  const messages: string[] = []
  const writer: JobSseWriter = {
    write: async () => undefined,
    writeSSE: async (message) => {
      if (message.id !== undefined) messages.push(message.id)
    }
  }
  const acknowledged = event(2)
  const later = event(3)
  const session = new JobSseSession(writer, {
    initialEventId: acknowledged.id,
    initialSequence: acknowledged.sequence,
    maxBufferedEvents: 2,
    onOverflow: () => undefined,
    onStop: () => undefined,
    onTerminal: () => undefined
  })
  await session.replay([])

  // When
  session.receive(acknowledged)
  session.receive(later)
  await Promise.resolve()
  await Promise.resolve()

  // Then
  expect(messages).toEqual([later.id])
})
