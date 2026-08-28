import {
  CompletionSchema,
  FailureSchema,
  HeartbeatSchema,
  OutputSchema,
  type RunnerClaim
} from "@interview-helper/runner"

type RunnerOutput = {
  readonly sequence: number
  readonly stream: "stdout" | "stderr"
  readonly chunk: string
}
export type RunnerLeaseSnapshot = {
  readonly claim: RunnerClaim
  readonly state: "claimed" | "running" | "completed" | "failed" | "cancelled"
  readonly outputs: readonly RunnerOutput[]
}

export class RunnerLeaseLedger {
  private readonly leases = new Map<string, RunnerLeaseSnapshot>()

  claim(claim: RunnerClaim): RunnerLeaseSnapshot {
    const existing = this.leases.get(claim.runId)
    if (existing !== undefined) {
      if (
        existing.claim.leaseId !== claim.leaseId ||
        existing.claim.requestHash !== claim.requestHash
      )
        throw new RunnerLeaseError("claim_conflict")
      return existing
    }
    const snapshot = { claim, state: "claimed", outputs: [] } as const
    this.leases.set(claim.runId, snapshot)
    return snapshot
  }

  acknowledge(message: unknown): RunnerLeaseSnapshot {
    const heartbeat = HeartbeatSchema.safeParse(message)
    if (!heartbeat.success) throw new RunnerLeaseError("invalid_message")
    const current = this.active(heartbeat.data.runId, heartbeat.data.leaseId)
    return this.replace(current, { ...current, state: "running" })
  }

  output(message: unknown): RunnerLeaseSnapshot {
    const value = OutputSchema.parse(message)
    const current = this.active(value.runId, value.leaseId)
    const expected = current.outputs.length + 1
    if (value.sequence !== expected) {
      const duplicate = current.outputs[value.sequence - 1]
      if (
        duplicate?.sequence === value.sequence &&
        duplicate.stream === value.stream &&
        duplicate.chunk === value.chunk
      )
        return current
      throw new RunnerLeaseError("sequence_conflict")
    }
    return this.replace(current, {
      ...current,
      state: "running",
      outputs: [
        ...current.outputs,
        { sequence: value.sequence, stream: value.stream, chunk: value.chunk }
      ]
    })
  }

  complete(message: unknown): RunnerLeaseSnapshot {
    const value = CompletionSchema.parse(message)
    const current = this.active(value.runId, value.leaseId)
    return this.replace(current, { ...current, state: "completed" })
  }

  fail(message: unknown): RunnerLeaseSnapshot {
    const value = FailureSchema.parse(message)
    const current = this.active(value.runId, value.leaseId)
    return this.replace(current, {
      ...current,
      state: value.code === "cancelled" ? "cancelled" : "failed"
    })
  }

  reconnect(runId: string, leaseId: string): RunnerLeaseSnapshot {
    const current = this.leases.get(runId)
    if (current === undefined || current.claim.leaseId !== leaseId)
      throw new RunnerLeaseError("lease_denied")
    return current
  }

  private active(runId: string, leaseId: string): RunnerLeaseSnapshot {
    const current = this.reconnect(runId, leaseId)
    if (["completed", "failed", "cancelled"].includes(current.state))
      throw new RunnerLeaseError("terminal")
    return current
  }

  private replace(
    current: RunnerLeaseSnapshot,
    replacement: RunnerLeaseSnapshot
  ): RunnerLeaseSnapshot {
    this.leases.set(current.claim.runId, replacement)
    return replacement
  }
}

export class RunnerLeaseError extends Error {
  override readonly name = "RunnerLeaseError"
  constructor(
    readonly code:
      "claim_conflict" | "invalid_message" | "lease_denied" | "sequence_conflict" | "terminal"
  ) {
    super(`RUNNER_LEASE_${code.toUpperCase()}`)
  }
}
