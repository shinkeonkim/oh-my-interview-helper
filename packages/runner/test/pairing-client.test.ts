import { describe, expect, test } from "bun:test"

import {
  RUNNER_PROTOCOL_VERSION,
  pairOutboundRunner,
  type PairingSocket,
  type PairingSocketFactory
} from "../src"

const request = {
  runnerName: "desk-runner",
  pairingCode: "AB12CD34",
  capabilities: {
    claudeSubscription: true,
    claudeDirectAuth: false,
    claudeBare: false,
    codexSkipGitRepoCheck: true,
    claudeVersion: "claude 1.2.3",
    codexVersion: "codex 1.2.3"
  }
} as const

const fakeSocket = (): PairingSocket => ({
  onopen: null,
  onmessage: null,
  onerror: null,
  onclose: null,
  send() {},
  close() {}
})

describe("runner pairing client", () => {
  test("sends a strict pairing request and returns accepted credentials", async () => {
    const socket = fakeSocket()
    let sent = ""
    let closed = false
    socket.send = (message) => {
      sent = message
    }
    socket.close = () => {
      closed = true
    }
    const pairing = pairOutboundRunner(
      "ws://127.0.0.1:3000/api/runner/ws",
      request,
      () => socket,
      100
    )
    socket.onopen?.()
    socket.onmessage?.({
      data: JSON.stringify({
        version: RUNNER_PROTOCOL_VERSION,
        type: "pair_accepted",
        runnerId: "11111111-1111-4111-8111-111111111111",
        token: "t".repeat(32),
        expiresAt: null
      })
    })

    expect(JSON.parse(sent)).toMatchObject({ type: "pair_request", pairingCode: "AB12CD34" })
    expect(await pairing).toMatchObject({ runnerId: "11111111-1111-4111-8111-111111111111" })
    expect(closed).toBeTrue()
  })

  test("fails boundedly on timeout, policy rejection, and a non-loopback endpoint", async () => {
    const timeout = pairOutboundRunner(
      "ws://localhost:3000/api/runner/ws",
      request,
      () => fakeSocket(),
      1
    )
    await expect(timeout).rejects.toThrow("RUNNER_PAIRING_TIMEOUT")

    const rejectedSocket = fakeSocket()
    const rejected = pairOutboundRunner(
      "ws://localhost:3000/api/runner/ws",
      request,
      () => rejectedSocket,
      100
    )
    rejectedSocket.onclose?.({ code: 1008, reason: "pairing_denied" })
    await expect(rejected).rejects.toThrow("RUNNER_PAIRING_PAIRING_REJECTED")

    let created = false
    const factory: PairingSocketFactory = () => {
      created = true
      return fakeSocket()
    }
    await expect(
      pairOutboundRunner("ws://attacker.invalid/runner", request, factory, 1)
    ).rejects.toThrow("RUNNER_CONNECTION_ENDPOINT_DENIED")
    expect(created).toBeFalse()
  })
})
