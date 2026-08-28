import { createHash, randomBytes } from "node:crypto"

import { RUNNER_PROTOCOL_VERSION, RunnerInboundMessageSchema, type RunnerClaim } from "./protocol"
import type { RunnerExecutionResult } from "./process-executor"

export type RunnerCredentials = { readonly runnerId: string; readonly token: string }
export type RunnerSocket = {
  readonly send: (data: string) => void
  readonly close: () => void
}
export type RunnerClaimExecutor = {
  readonly execute: (claim: RunnerClaim, signal?: AbortSignal) => Promise<RunnerExecutionResult>
}
export type OutboundWebSocket = RunnerSocket & {
  onopen: (() => void) | null
  onmessage: ((event: { readonly data: string }) => void) | null
  onerror: (() => void) | null
  binaryType: string
}
export type OutboundWebSocketFactory = (url: string) => OutboundWebSocket

type ActiveRun = { readonly leaseId: string; readonly controller: AbortController }
type TerminalRun = { readonly leaseId: string; readonly messages: readonly string[] }

export class RunnerConnection {
  private socket: RunnerSocket | null = null
  private readonly active = new Map<string, ActiveRun>()
  private readonly terminal = new Map<string, TerminalRun>()

  constructor(
    private readonly credentials: RunnerCredentials,
    private readonly executor: RunnerClaimExecutor
  ) {}

  attach(socket: RunnerSocket): void {
    this.socket = socket
    this.send({
      version: RUNNER_PROTOCOL_VERSION,
      type: "authenticate",
      runnerId: this.credentials.runnerId,
      token: this.credentials.token,
      nonce: randomBytes(18).toString("base64url")
    })
  }

  async receive(raw: string): Promise<void> {
    const message = RunnerInboundMessageSchema.parse(JSON.parse(raw))
    if (message.type === "pair_accepted") return
    if (message.type === "cancel") {
      const active = this.active.get(message.runId)
      if (active?.leaseId === message.leaseId) active.controller.abort()
      return
    }
    await this.execute(message)
  }

  private async execute(claim: RunnerClaim): Promise<void> {
    const completed = this.terminal.get(claim.runId)
    if (completed !== undefined) {
      if (completed.leaseId !== claim.leaseId) throw new RunnerConnectionError("lease_conflict")
      for (const message of completed.messages) this.socket?.send(message)
      return
    }
    const existing = this.active.get(claim.runId)
    if (existing !== undefined) {
      if (existing.leaseId !== claim.leaseId) throw new RunnerConnectionError("lease_conflict")
      this.sendBase("ack", claim)
      return
    }
    const controller = new AbortController()
    this.active.set(claim.runId, { leaseId: claim.leaseId, controller })
    this.sendBase("ack", claim)
    const result = await this.executor.execute(claim, controller.signal)
    const messages = this.resultMessages(claim, result)
    this.active.delete(claim.runId)
    this.terminal.set(claim.runId, { leaseId: claim.leaseId, messages })
    for (const message of messages) this.socket?.send(message)
  }

  private resultMessages(claim: RunnerClaim, result: RunnerExecutionResult): readonly string[] {
    if (result.kind === "failed")
      return [
        JSON.stringify({
          version: RUNNER_PROTOCOL_VERSION,
          type: "failure",
          runId: claim.runId,
          leaseId: claim.leaseId,
          code: result.code,
          retryable: false
        })
      ]
    const output = `${result.stdout}${result.stderr}`
    const chunks = chunkOutput(result.stdout).map((chunk, index) => ({
      version: RUNNER_PROTOCOL_VERSION,
      type: "output",
      runId: claim.runId,
      leaseId: claim.leaseId,
      sequence: index + 1,
      stream: "stdout",
      chunk
    }))
    const stderr = chunkOutput(result.stderr).map((chunk, index) => ({
      version: RUNNER_PROTOCOL_VERSION,
      type: "output",
      runId: claim.runId,
      leaseId: claim.leaseId,
      sequence: chunks.length + index + 1,
      stream: "stderr",
      chunk
    }))
    return [
      ...chunks.map((value) => JSON.stringify(value)),
      ...stderr.map((value) => JSON.stringify(value)),
      JSON.stringify({
        version: RUNNER_PROTOCOL_VERSION,
        type: "completion",
        runId: claim.runId,
        leaseId: claim.leaseId,
        exitCode: 0,
        outputHash: createHash("sha256").update(output).digest("hex")
      })
    ]
  }

  private sendBase(type: "ack", claim: RunnerClaim): void {
    this.send({
      version: RUNNER_PROTOCOL_VERSION,
      type,
      runId: claim.runId,
      leaseId: claim.leaseId
    })
  }

  private send(value: unknown): void {
    if (this.socket === null) throw new RunnerConnectionError("not_connected")
    this.socket.send(JSON.stringify(value))
  }
}

export const connectOutboundRunner = (
  endpoint: string,
  connection: RunnerConnection,
  createSocket: OutboundWebSocketFactory = (url) =>
    new WebSocket(url) as unknown as OutboundWebSocket
): OutboundWebSocket => {
  const url = new URL(endpoint)
  if (
    !["ws:", "wss:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)
  )
    throw new RunnerConnectionError("endpoint_denied")
  const socket = createSocket(url.toString())
  socket.binaryType = "blob"
  socket.onopen = () => connection.attach(socket)
  socket.onmessage = (event) => {
    void connection.receive(event.data).catch(() => socket.close())
  }
  socket.onerror = () => socket.close()
  return socket
}

const chunkOutput = (value: string): readonly string[] => {
  const chunks: string[] = []
  for (let offset = 0; offset < value.length; offset += 65_536)
    chunks.push(value.slice(offset, offset + 65_536))
  return chunks
}

export class RunnerConnectionError extends Error {
  override readonly name = "RunnerConnectionError"
  constructor(readonly code: "endpoint_denied" | "lease_conflict" | "not_connected") {
    super(`RUNNER_CONNECTION_${code.toUpperCase()}`)
  }
}
