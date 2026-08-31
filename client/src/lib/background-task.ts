type Job = {
  id: string
  state: "queued" | "leased" | "running" | "succeeded" | "failed" | "cancelled"
}
type JobEvent = { kind: string; payload: Record<string, unknown> }

export const backgroundTaskPhaseLabel = (phase: string | null, locale: "ko" | "en") => {
  if (phase === null) return null
  const labels: Record<string, readonly [string, string]> = {
    researching: ["공개 근거 수집 및 분석", "Collecting and analyzing public evidence"],
    searching: ["여러 채용 사이트 탐색", "Searching job sites"],
    generating: ["근거 기반 초안 생성", "Generating an evidence-based draft"],
    answering: ["선택한 근거로 답변 작성", "Answering from selected evidence"],
    result: ["결과 정리", "Finalizing results"]
  }
  return labels[phase]?.[locale === "ko" ? 0 : 1] ?? phase
}

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
  signal?: AbortSignal,
  scope?: string
): Promise<Record<string, unknown>> => {
  const response = await fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ kind, input, idempotencyKey: crypto.randomUUID() }),
    signal
  })
  if (!response.ok) throw new Error("task_enqueue_failed")
  const job = (await response.json()) as Job
  if (scope !== undefined) localStorage.setItem(`background-task:${scope}`, job.id)
  return monitorBackgroundTask(job.id, onState, signal, scope)
}

const monitorBackgroundTask = async (
  jobId: string,
  onState: (state: Job["state"], phase: string | null) => void,
  signal?: AbortSignal,
  scope?: string
): Promise<Record<string, unknown>> => {
  let job: Job = { id: jobId, state: "queued" }
  let result: Record<string, unknown> = {}
  while (!(["succeeded", "failed", "cancelled"] as string[]).includes(job.state)) {
    const [jobResponse, eventResponse] = await Promise.all([
      fetch(`/api/jobs/${jobId}`, { signal }),
      fetch(`/api/jobs/${jobId}/events?transport=poll`, { signal })
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
  const finalEventsResponse = await fetch(`/api/jobs/${jobId}/events?transport=poll`, { signal })
  if (!finalEventsResponse.ok) throw new Error("task_status_failed")
  for (const event of ((await finalEventsResponse.json()) as { events: JobEvent[] }).events)
    if (event.kind === "progress" && event.payload["phase"] === "result") result = event.payload
  onState(job.state, null)
  if (job.state !== "succeeded") throw new Error(`task_${job.state}`)
  if (scope !== undefined) localStorage.removeItem(`background-task:${scope}`)
  return result
}

export const resumeBackgroundTask = (
  scope: string,
  onState: (state: Job["state"], phase: string | null) => void,
  signal?: AbortSignal
): Promise<Record<string, unknown>> | null => {
  const jobId = localStorage.getItem(`background-task:${scope}`)
  return jobId === null ? null : monitorBackgroundTask(jobId, onState, signal, scope)
}
