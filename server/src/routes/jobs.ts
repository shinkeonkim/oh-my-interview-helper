import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { z } from "zod"

import {
  CanonicalJobInputSchema,
  IdempotencyConflictError,
  JobInputSecretError,
  JobTransitionError,
  UnknownJobKindError,
  assertSecretFreeJobInput,
  isTerminalJobState,
  type JobEvent
} from "../jobs/types"
import type { JobRuntime } from "../jobs/runtime"
import { JobSseSession, type JobSseOverflowSignal } from "./job-sse-session"

const EnqueueSchema = z
  .object({
    kind: z.string().trim().min(1),
    input: CanonicalJobInputSchema,
    idempotencyKey: z.string().uuid()
  })
  .strict()
const LastEventIdSchema = z.string().uuid()
const TransportSchema = z.enum(["poll", "sse"])

export type JobsRouteOptions = {
  readonly afterReplaySnapshot?: (jobId: string) => void
  readonly heartbeatMilliseconds?: number
  readonly maxBufferedEvents?: number
  readonly onOverflow?: (jobId: string, signal: JobSseOverflowSignal) => void
  readonly onSubscribe?: (jobId: string) => void
  readonly onUnsubscribe?: (jobId: string) => void
}

const error = (code: string, status: 400 | 404 | 409 | 422): Response =>
  Response.json({ error: { code } }, { status })

const hasJsonContentType = (value: string | undefined): boolean =>
  value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json"

const hasInput = (value: unknown): value is { readonly input: unknown } =>
  typeof value === "object" && value !== null && "input" in value

const waitForHeartbeat = (signal: AbortSignal, milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds)
    const cancel = (): void => {
      clearTimeout(timer)
      done()
    }
    function done(): void {
      signal.removeEventListener("abort", cancel)
      resolve()
    }
    signal.addEventListener("abort", cancel, { once: true })
  })

export const createJobsRoutes = (runtime: JobRuntime, options: JobsRouteOptions = {}): Hono => {
  const app = new Hono()
  const heartbeatMilliseconds = options.heartbeatMilliseconds ?? 15_000
  const maxBufferedEvents = options.maxBufferedEvents ?? 64

  app.post("/", async (context) => {
    if (!hasJsonContentType(context.req.header("content-type")))
      return error("JOB_CONTENT_TYPE_INVALID", 400)
    let payload: unknown
    try {
      payload = await context.req.json()
    } catch {
      return error("JOB_REQUEST_MALFORMED", 400)
    }
    if (hasInput(payload)) {
      try {
        assertSecretFreeJobInput(payload.input)
      } catch (caught) {
        if (caught instanceof JobInputSecretError) return error(caught.message, 400)
        throw caught
      }
    }
    const body = EnqueueSchema.safeParse(payload)
    if (!body.success) return error("JOB_REQUEST_INVALID", 400)
    try {
      return context.json(runtime.enqueue(body.data), 201)
    } catch (caught) {
      if (caught instanceof JobInputSecretError) return error(caught.message, 400)
      if (caught instanceof UnknownJobKindError) return error("UNKNOWN_JOB_KIND", 400)
      if (caught instanceof IdempotencyConflictError) return error("IDEMPOTENCY_CONFLICT", 409)
      throw caught
    }
  })

  app.get("/", (context) => context.json(runtime.repository.list()))
  app.get("/:id", (context) => {
    const job = runtime.repository.get({ id: context.req.param("id") })
    return job === null ? error("JOB_NOT_FOUND", 404) : context.json(job)
  })
  app.post("/:id/cancel", (context) => {
    try {
      return context.json(runtime.cancel(context.req.param("id")))
    } catch (caught) {
      if (caught instanceof JobTransitionError) return error(caught.code, 404)
      throw caught
    }
  })
  app.get("/:id/events", (context) => {
    const id = context.req.param("id")
    const job = runtime.repository.get({ id })
    if (job === null) return error("JOB_NOT_FOUND", 404)
    const transport = TransportSchema.safeParse(context.req.query("transport") ?? "sse")
    if (!transport.success) return error("EVENT_TRANSPORT_INVALID", 400)
    const rawLastEventId = context.req.header("last-event-id")
    const lastEventId =
      rawLastEventId === undefined ? null : LastEventIdSchema.safeParse(rawLastEventId)
    if (lastEventId !== null && !lastEventId.success) return error("LAST_EVENT_ID_INVALID", 400)
    const eventId = lastEventId === null ? null : lastEventId.data
    if (transport.data === "poll") {
      const replay = runtime.repository.eventsAfter({ id, eventId })
      return replay.kind === "reset"
        ? error(replay.code, 409)
        : context.json({ events: replay.events })
    }

    const replay = runtime.repository.eventsAfter({ id, eventId })
    if (replay.kind === "reset") return error(replay.code, 409)
    const cursor =
      eventId === null
        ? null
        : runtime.repository.events({ id }).find((event) => event.id === eventId)
    const initialEventId = cursor?.id ?? null
    const initialSequence = cursor?.sequence ?? 0
    if (isTerminalJobState(job.state))
      return streamSSE(context, async (stream) => {
        const session = new JobSseSession(stream, {
          initialEventId,
          initialSequence,
          maxBufferedEvents,
          onOverflow: (signal) => options.onOverflow?.(id, signal),
          onStop: () => undefined,
          onTerminal: () => undefined
        })
        await session.replay(replay.events)
      })

    const buffered: JobEvent[] = []
    let session: JobSseSession | null = null
    const unsubscribe = runtime.subscribe(id, (event) => {
      if (session === null) buffered.push(event)
      else session.receive(event)
    })
    options.onSubscribe?.(id)
    const liveReplay = runtime.repository.eventsAfter({ id, eventId })
    if (liveReplay.kind === "reset") {
      unsubscribe()
      return error(liveReplay.code, 409)
    }
    return streamSSE(context, async (stream) => {
      const wake = new AbortController()
      let cleaned = false
      const cleanup = (): void => {
        if (cleaned) return
        cleaned = true
        unsubscribe()
        options.onUnsubscribe?.(id)
      }
      stream.onAbort(() => {
        wake.abort()
        cleanup()
      })
      session = new JobSseSession(stream, {
        initialEventId,
        initialSequence,
        maxBufferedEvents,
        onOverflow: (signal) => options.onOverflow?.(id, signal),
        onStop: () => {
          wake.abort()
          cleanup()
        },
        onTerminal: () => wake.abort()
      })
      for (const event of buffered) session.receive(event)
      try {
        options.afterReplaySnapshot?.(id)
        await session.replay(liveReplay.events)
        while (!stream.aborted && !session.isStopped && !session.isTerminal) {
          await session.heartbeat()
          await waitForHeartbeat(wake.signal, heartbeatMilliseconds)
        }
      } finally {
        wake.abort()
        cleanup()
      }
    })
  })
  return app
}
