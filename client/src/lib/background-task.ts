type Job = {
  id: string
  state: "queued" | "leased" | "running" | "succeeded" | "failed" | "cancelled"
}
type JobEvent = { kind: string; payload: Record<string, unknown> }

const wait = (milliseconds: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds)
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer)
        reject(new DOMException("Aborted", "AbortError"))
      },
      { once: true }
    )
  })

export const runBackgroundTask = async (
  kind: string,
  input: Record<string, unknown>,
  csrfToken: string,
  onState: (state: Job["state"], phase: string | null) => void,
  signal?: AbortSignal
): Promise<Record<string, unknown>> => {
  const response = await fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ kind, input, idempotencyKey: crypto.randomUUID() }),
    signal
  })
  if (!response.ok) throw new Error("task_enqueue_failed")
  let job = (await response.json()) as Job
  let result: Record<string, unknown> = {}
  while (!(["succeeded", "failed", "cancelled"] as string[]).includes(job.state)) {
    const [jobResponse, eventResponse] = await Promise.all([
      fetch(`/api/jobs/${job.id}`, { signal }),
      fetch(`/api/jobs/${job.id}/events?transport=poll`, { signal })
    ])
    if (!jobResponse.ok || !eventResponse.ok) throw new Error("task_status_failed")
    job = (await jobResponse.json()) as Job
    const events = ((await eventResponse.json()) as { events: JobEvent[] }).events
    for (const event of events) {
      if (event.kind === "progress") {
        const phase = typeof event.payload["phase"] === "string" ? event.payload["phase"] : null
        onState(job.state, phase)
        if (phase === "result") result = event.payload
      }
    }
    if (!(["succeeded", "failed", "cancelled"] as string[]).includes(job.state))
      await wait(400, signal)
  }
  const finalEventsResponse = await fetch(`/api/jobs/${job.id}/events?transport=poll`, { signal })
  if (!finalEventsResponse.ok) throw new Error("task_status_failed")
  for (const event of ((await finalEventsResponse.json()) as { events: JobEvent[] }).events)
    if (event.kind === "progress" && event.payload["phase"] === "result") result = event.payload
  onState(job.state, null)
  if (job.state !== "succeeded") throw new Error(`task_${job.state}`)
  return result
}
