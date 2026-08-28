import { describe, expect, test } from "bun:test"

import {
  ClaimSchema,
  RUNNER_PROTOCOL_VERSION,
  RunnerConnection,
  connectOutboundRunner,
  type OutboundWebSocket
} from "../src"

const claim = ClaimSchema.parse({
  version: RUNNER_PROTOCOL_VERSION,
  type: "claim",
  runId: crypto.randomUUID(),
  leaseId: crypto.randomUUID(),
  provider: "claude-cli",
  model: "sonnet",
  prompt: "prompt",
  requestHash: "a".repeat(64),
  deadline: "2026-08-28T12:00:00.000Z"
})

describe("outbound runner connection", () => {
  test("authenticates, executes a claim once, and replays terminal messages after reconnect", async () => {
    const sent: string[] = []
    let executions = 0
    const connection = new RunnerConnection(
      { runnerId: crypto.randomUUID(), token: "t".repeat(32) },
      {
        execute: async () => {
          executions += 1
          return { kind: "completed", stdout: "one", stderr: "" }
        }
      }
    )
    connection.attach({ send: (message) => sent.push(message), close() {} })
    await connection.receive(JSON.stringify(claim))
    const first = [...sent]
    sent.length = 0
    connection.attach({ send: (message) => sent.push(message), close() {} })
    await connection.receive(JSON.stringify(claim))

    expect(executions).toBe(1)
    expect(JSON.parse(first[0] ?? "{}").type).toBe("authenticate")
    expect(first.map((message) => JSON.parse(message).type)).toEqual([
      "authenticate",
      "ack",
      "output",
      "completion"
    ])
    expect(sent.map((message) => JSON.parse(message).type)).toEqual([
      "authenticate",
      "output",
      "completion"
    ])
  })

  test("cancels only the matching active lease and rejects a divergent reclaim", async () => {
    let aborted = false
    let release: (() => void) | undefined
    const connection = new RunnerConnection(
      { runnerId: crypto.randomUUID(), token: "t".repeat(32) },
      {
        execute: (_claim, signal) =>
          new Promise((resolve) => {
            release = () => resolve({ kind: "failed", code: "cancelled" })
            signal?.addEventListener("abort", () => {
              aborted = true
              release?.()
            })
          })
      }
    )
    connection.attach({ send() {}, close() {} })
    const running = connection.receive(JSON.stringify(claim))
    await Promise.resolve()
    await connection.receive(
      JSON.stringify({
        version: RUNNER_PROTOCOL_VERSION,
        type: "cancel",
        runId: claim.runId,
        leaseId: claim.leaseId
      })
    )
    await running
    expect(aborted).toBeTrue()
    await expect(
      connection.receive(JSON.stringify({ ...claim, leaseId: crypto.randomUUID() }))
    ).rejects.toThrow("RUNNER_CONNECTION_LEASE_CONFLICT")
  })

  test("initiates only an outbound localhost WebSocket and closes on forged input", async () => {
    const sent: string[] = []
    let openedUrl = ""
    const socket: OutboundWebSocket = {
      binaryType: "",
      onopen: null,
      onmessage: null,
      onerror: null,
      send: (message) => sent.push(message),
      close() {}
    }
    const connection = new RunnerConnection(
      { runnerId: crypto.randomUUID(), token: "t".repeat(32) },
      { execute: async () => ({ kind: "completed", stdout: "", stderr: "" }) }
    )
    connectOutboundRunner("ws://127.0.0.1:3000/api/runner/ws", connection, (url) => {
      openedUrl = url
      return socket
    })
    socket.onopen?.()

    expect(openedUrl).toBe("ws://127.0.0.1:3000/api/runner/ws")
    expect(JSON.parse(sent[0] ?? "{}").type).toBe("authenticate")
    expect(() =>
      connectOutboundRunner("ws://attacker.invalid/runner", connection, () => socket)
    ).toThrow("RUNNER_CONNECTION_ENDPOINT_DENIED")
  })
})
