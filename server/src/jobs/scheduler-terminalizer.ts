import type { JobDefinition, JobRuntime } from "./runtime"
import type { Job, TerminalJobState } from "./types"

export type TerminalAction =
  | { readonly kind: "succeed" }
  | { readonly kind: "fail"; readonly code: string; readonly message: string }
  | { readonly kind: "cancel" }
  | { readonly kind: "interrupt" }
export type TerminalReason = "succeeded" | "failed" | "timeout" | "cancelled" | "interrupted"

export const reconcile = (runtime: JobRuntime, now: string): void => {
  for (const job of runtime.repository.recoverExpired({ now })) runtime.reconcile(job)
}
export const terminalize = (
  runtime: JobRuntime,
  definition: JobDefinition,
  job: Job,
  owner: string,
  now: string,
  reason: TerminalReason,
  action: TerminalAction
): void => {
  runtime.repository.terminal({
    id: job.id,
    owner,
    now,
    action,
    onTerminal: (terminal, state: TerminalJobState) =>
      definition.terminal?.({ job: terminal, state, reason })
  })
}
