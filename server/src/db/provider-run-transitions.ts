import type { Database } from "bun:sqlite"

import type { ProviderRunId } from "./ids"
import {
  ProviderRunCreateSchema,
  ProviderRunMetadataSchema,
  mapProviderRun,
  type ProviderRun
} from "./provider-artifact-repository-schemas"

export class ProviderRunTransitionError extends Error {
  override readonly name = "ProviderRunTransitionError"
  constructor() {
    super("PROVIDER_RUN_TRANSITION_INVALID")
  }
}

export type ProviderRunTerminal = {
  readonly status: "succeeded" | "failed" | "cancelled"
  readonly usage: ProviderRun["usage"]
  readonly cost: ProviderRun["cost"]
  readonly error: ProviderRun["error"]
}

const now = (): string => new Date().toISOString()

export const transitionProviderRun = (
  database: Database,
  id: ProviderRunId,
  terminal: ProviderRunTerminal
): ProviderRun => {
  const row = database
    .query<unknown, [ProviderRunId]>(
      "SELECT id,provider_kind providerKind,status,request_hash requestHash,usage_json metadata,completed_at completedAt FROM provider_runs WHERE id=?"
    )
    .get(id)
  if (row === null) throw new ProviderRunTransitionError()
  const running = mapProviderRun(row)
  if (running.status !== "running") throw new ProviderRunTransitionError()
  const completedAt = now()
  const metadata = ProviderRunMetadataSchema.parse({
    mode: running.mode,
    model: running.model,
    usage: terminal.usage,
    cost: terminal.cost,
    error: terminal.error
  })
  const changed = database.run(
    "UPDATE provider_runs SET status=?,usage_json=?,completed_at=? WHERE id=? AND status='running'",
    [terminal.status, JSON.stringify(metadata), completedAt, id]
  ).changes
  if (changed !== 1) throw new ProviderRunTransitionError()
  return ProviderRunCreateSchema.parse({
    ...running,
    ...terminal,
    completedAt
  })
}
