import { describe, expect, test } from "bun:test"

import { ClaimSchema, RUNNER_PROTOCOL_VERSION } from "@interview-helper/runner"

import { RunnerLeaseError, RunnerLeaseLedger } from "../src/runner/lease-ledger"

const claim = ClaimSchema.parse({
  version: RUNNER_PROTOCOL_VERSION,
  type: "claim",
  runId: crypto.randomUUID(),
  leaseId: crypto.randomUUID(),
  provider: "codex-cli",
  model: "gpt-5.4",
  prompt: "prompt",
  requestHash: "a".repeat(64),
  deadline: "2026-08-27T12:00:00.000Z"
})
const base = { version: RUNNER_PROTOCOL_VERSION, runId: claim.runId, leaseId: claim.leaseId }

describe("runner lease reconnect ledger", () => {
  test("returns the same claim and ordered output snapshot after reconnect", () => {
    const ledger = new RunnerLeaseLedger()
    ledger.claim(claim)
    ledger.acknowledge({ ...base, type: "heartbeat" })
    const first = { ...base, type: "output", sequence: 1, stream: "stdout", chunk: "one" }
    ledger.output(first)
    ledger.output(first)

    expect(ledger.claim(claim)).toEqual(ledger.reconnect(claim.runId, claim.leaseId))
    expect(ledger.reconnect(claim.runId, claim.leaseId).outputs).toEqual([
      { sequence: 1, stream: "stdout", chunk: "one" }
    ])
  })

  test("rejects forged leases, divergent reclaims, and output gaps", () => {
    const ledger = new RunnerLeaseLedger()
    ledger.claim(claim)
    expect(() => ledger.reconnect(claim.runId, crypto.randomUUID())).toThrow(RunnerLeaseError)
    expect(() => ledger.claim({ ...claim, leaseId: crypto.randomUUID() })).toThrow(
      "RUNNER_LEASE_CLAIM_CONFLICT"
    )
    expect(() =>
      ledger.output({ ...base, type: "output", sequence: 2, stream: "stdout", chunk: "gap" })
    ).toThrow("RUNNER_LEASE_SEQUENCE_CONFLICT")
  })

  test("makes successful and failed terminal states immutable", () => {
    const ledger = new RunnerLeaseLedger()
    ledger.claim(claim)
    ledger.complete({ ...base, type: "completion", exitCode: 0, outputHash: "b".repeat(64) })
    expect(() =>
      ledger.complete({ ...base, type: "completion", exitCode: 0, outputHash: "b".repeat(64) })
    ).toThrow("RUNNER_LEASE_TERMINAL")
    expect(() =>
      ledger.output({ ...base, type: "output", sequence: 1, stream: "stdout", chunk: "late" })
    ).toThrow("RUNNER_LEASE_TERMINAL")
  })
})
