import { createHash } from "node:crypto"

import {
  AuthenticateSchema,
  PairRequestSchema,
  RUNNER_PROTOCOL_VERSION,
  RunnerOutboundMessageSchema,
  normalizeCliOutputLine,
  type RunnerClaim
} from "@interview-helper/runner"

import type { CliProviderId, CliRunnerTransport, CliTransportEvent } from "../providers"
import { RunnerLeaseLedger } from "./lease-ledger"
import type { RunnerPairingService } from "./pairing"

export type HubSocketData = { runnerId: string | null; capabilities: Set<CliProviderId> }
export type HubSocket = {
  readonly data: HubSocketData
  readonly send: (message: string) => void
  readonly close: (code?: number, reason?: string) => void
}

type PendingRun = {
  readonly claim: RunnerClaim
  readonly queue: AsyncEventQueue
  readonly runnerId: string
  readonly processedSequences: Set<number>
  stdoutBuffer: string
}

export class RunnerWebSocketHub implements CliRunnerTransport {
  private readonly sockets = new Set<HubSocket>()
  private readonly pending = new Map<string, PendingRun>()
  private readonly leases = new RunnerLeaseLedger()

  constructor(private readonly pairing: RunnerPairingService) {}

  connected(provider: CliProviderId): boolean {
    return [...this.sockets].some(
      (socket) => socket.data.runnerId !== null && socket.data.capabilities.has(provider)
    )
  }

  open(socket: HubSocket): void {
    this.sockets.add(socket)
  }

  close(socket: HubSocket): void {
    this.sockets.delete(socket)
  }

  revoke(runnerId: string): void {
    for (const socket of this.sockets) {
      if (socket.data.runnerId !== runnerId) continue
      this.sockets.delete(socket)
      socket.close(1008, "runner_revoked")
    }
    for (const [runId, pending] of this.pending) {
      if (pending.runnerId !== runnerId) continue
      pending.queue.fail(new RunnerHubError("runner_revoked"))
      this.pending.delete(runId)
    }
  }

  async message(socket: HubSocket, raw: string): Promise<void> {
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      socket.close(1008, "invalid_protocol")
      return
    }
    if (socket.data.runnerId === null) {
      const pair = PairRequestSchema.safeParse(value)
      if (pair.success) {
        const accepted = this.pairing.pair({
          code: pair.data.pairingCode,
          runnerName: pair.data.runnerName,
          capabilities: { protocolVersion: 1, ...pair.data.capabilities }
        })
        socket.data.runnerId = accepted.runnerId
        socket.data.capabilities = providerCapabilities(pair.data.capabilities)
        socket.send(
          JSON.stringify({
            version: RUNNER_PROTOCOL_VERSION,
            type: "pair_accepted",
            ...accepted,
            expiresAt: null
          })
        )
        return
      }
      const auth = AuthenticateSchema.safeParse(value)
      const authenticated = auth.success ? this.pairing.authorize(auth.data) : null
      if (!auth.success || authenticated === null) {
        socket.close(1008, "authentication_failed")
        return
      }
      socket.data.runnerId = auth.data.runnerId
      socket.data.capabilities = providerCapabilities(authenticated.capabilities)
      for (const pending of this.pending.values())
        if (pending.runnerId === auth.data.runnerId) socket.send(JSON.stringify(pending.claim))
      return
    }
    const message = RunnerOutboundMessageSchema.safeParse(value)
    if (
      !message.success ||
      message.data.type === "pair_request" ||
      message.data.type === "authenticate"
    ) {
      socket.close(1008, "invalid_protocol")
      return
    }
    const data = message.data
    if (data.type === "ack" || data.type === "heartbeat") {
      this.leases.acknowledge({ ...data, type: "heartbeat" })
      this.pairing.touch(socket.data.runnerId)
      return
    }
    const pending = this.pending.get(data.runId)
    if (pending === undefined) return
    if (data.type === "output") {
      this.leases.output(data)
      if (pending.processedSequences.has(data.sequence)) return
      pending.processedSequences.add(data.sequence)
      if (data.stream === "stdout") {
        pending.stdoutBuffer += data.chunk
        const lines = pending.stdoutBuffer.split("\n")
        pending.stdoutBuffer = lines.pop() ?? ""
        for (const line of lines.filter(Boolean)) {
          const normalized = normalizeCliOutputLine(pending.claim.provider, line)
          if (normalized !== null) pending.queue.push(normalized)
        }
      }
      return
    }
    if (data.type === "completion") {
      this.leases.complete(data)
      if (pending.stdoutBuffer.length > 0) {
        const normalized = normalizeCliOutputLine(pending.claim.provider, pending.stdoutBuffer)
        if (normalized !== null) pending.queue.push(normalized)
      }
      pending.queue.end()
    } else if (data.type === "failure") {
      this.leases.fail(data)
      pending.queue.fail(new RunnerHubError(data.code))
    }
    this.pending.delete(data.runId)
  }

  async *stream(input: {
    readonly provider: CliProviderId
    readonly model: string
    readonly prompt: string
    readonly signal?: AbortSignal
  }): AsyncIterable<CliTransportEvent> {
    const socket = [...this.sockets].find(
      (candidate) =>
        candidate.data.runnerId !== null && candidate.data.capabilities.has(input.provider)
    )
    if (socket === undefined) throw new RunnerHubError("runner_unavailable")
    const runnerId = socket.data.runnerId
    if (runnerId === null) throw new RunnerHubError("runner_unavailable")
    const claim = {
      version: RUNNER_PROTOCOL_VERSION,
      type: "claim",
      runId: crypto.randomUUID(),
      leaseId: crypto.randomUUID(),
      provider: input.provider,
      model: input.model,
      prompt: input.prompt,
      requestHash: createHash("sha256").update(input.prompt).digest("hex"),
      deadline: new Date(Date.now() + 120_000).toISOString()
    } satisfies RunnerClaim
    const queue = new AsyncEventQueue()
    this.leases.claim(claim)
    this.pending.set(claim.runId, {
      claim,
      queue,
      runnerId,
      processedSequences: new Set(),
      stdoutBuffer: ""
    })
    const cancel = (): void =>
      socket.send(
        JSON.stringify({
          version: RUNNER_PROTOCOL_VERSION,
          type: "cancel",
          runId: claim.runId,
          leaseId: claim.leaseId
        })
      )
    input.signal?.addEventListener("abort", cancel, { once: true })
    socket.send(JSON.stringify(claim))
    try {
      yield* queue
    } finally {
      input.signal?.removeEventListener("abort", cancel)
      this.pending.delete(claim.runId)
    }
  }
}

const providerCapabilities = (capabilities: {
  readonly claudeSubscription: boolean
  readonly claudeDirectAuth: boolean
  readonly codexVersion: string | null
  readonly claudeVersion: string | null
}): Set<CliProviderId> =>
  new Set([
    ...(capabilities.claudeVersion !== null &&
    (capabilities.claudeSubscription || capabilities.claudeDirectAuth)
      ? (["claude-cli"] as const)
      : []),
    ...(capabilities.codexVersion !== null ? (["codex-cli"] as const) : [])
  ])

class AsyncEventQueue implements AsyncIterable<CliTransportEvent> {
  private readonly values: CliTransportEvent[] = []
  private readonly waiters: Array<() => void> = []
  private done = false
  private error: Error | null = null

  push(value: CliTransportEvent): void {
    this.values.push(value)
    this.waiters.shift()?.()
  }
  end(): void {
    this.done = true
    this.waiters.shift()?.()
  }
  fail(error: Error): void {
    this.error = error
    this.waiters.shift()?.()
  }
  async *[Symbol.asyncIterator](): AsyncIterator<CliTransportEvent> {
    for (;;) {
      const value = this.values.shift()
      if (value !== undefined) yield value
      else if (this.error !== null) throw this.error
      else if (this.done) return
      else await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
  }
}

export class RunnerHubError extends Error {
  override readonly name = "RunnerHubError"
  constructor(readonly code: string) {
    super(`RUNNER_HUB_${code.toUpperCase()}`)
  }
}
