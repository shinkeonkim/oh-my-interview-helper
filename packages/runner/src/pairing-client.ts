import type { z } from "zod"

import {
  PairAcceptedSchema,
  PairRequestSchema,
  RUNNER_PROTOCOL_VERSION,
  type PairAccepted
} from "./protocol"
import { validateRunnerEndpoint } from "./connection"

export type PairingSocket = {
  onopen: (() => void) | null
  onmessage: ((event: { readonly data: string }) => void) | null
  onerror: (() => void) | null
  onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null
  send(data: string): void
  close(): void
}
export type PairingSocketFactory = (url: string) => PairingSocket
export type PairingRequest = Omit<z.input<typeof PairRequestSchema>, "version" | "type">

export const pairOutboundRunner = async (
  endpoint: string,
  request: PairingRequest,
  createSocket: PairingSocketFactory = (url) => new WebSocket(url) as unknown as PairingSocket,
  timeoutMilliseconds = 30_000
): Promise<PairAccepted> => {
  const message = PairRequestSchema.parse({
    version: RUNNER_PROTOCOL_VERSION,
    type: "pair_request",
    ...request
  })
  const url = validateRunnerEndpoint(endpoint)
  return new Promise((resolve, reject) => {
    const socket = createSocket(url.toString())
    let settled = false
    const finish = (action: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      action()
    }
    const fail = (code: string): void => finish(() => reject(new PairingClientError(code)))
    const timer = setTimeout(() => fail("timeout"), timeoutMilliseconds)
    socket.onopen = () => socket.send(JSON.stringify(message))
    socket.onmessage = (event) => {
      try {
        const accepted = PairAcceptedSchema.parse(JSON.parse(String(event.data)))
        finish(() => resolve(accepted))
      } catch {
        fail("invalid_response")
      }
    }
    socket.onerror = () => fail("connection_failed")
    socket.onclose = (event) => {
      if (!settled) fail(event.code === 1008 ? "pairing_rejected" : "connection_closed")
    }
  })
}

export class PairingClientError extends Error {
  override readonly name = "PairingClientError"
  constructor(readonly code: string) {
    super(`RUNNER_PAIRING_${code.toUpperCase()}`)
  }
}
