import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { RUNNER_PROTOCOL_VERSION } from "@interview-helper/runner"

import { createPersistence, type Persistence } from "../src/db"
import { RunnerPairingService } from "../src/runner/pairing"
import { RunnerWebSocketHub, type HubSocket } from "../src/runner/websocket-hub"

const directories: string[] = []
const handles: Persistence[] = []
const setup = () => {
  const directory = mkdtempSync(join(tmpdir(), "runner-hub-"))
  directories.push(directory)
  const persistence = createPersistence({ dataDirectory: directory })
  handles.push(persistence)
  const pairing = new RunnerPairingService(persistence.database)
  const sent: string[] = []
  const socket: HubSocket = {
    data: { runnerId: null, capabilities: new Set() },
    send: (message) => sent.push(message),
    close() {}
  }
  const hub = new RunnerWebSocketHub(pairing)
  hub.open(socket)
  return { hub, pairing, sent, socket }
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("authenticated runner WebSocket hub", () => {
  test("pairs once and streams normalized runner output to the selected CLI provider", async () => {
    const harness = setup()
    const invitation = harness.pairing.issueCode()
    await harness.hub.message(
      harness.socket,
      JSON.stringify({
        version: RUNNER_PROTOCOL_VERSION,
        type: "pair_request",
        runnerName: "local",
        pairingCode: invitation.code,
        capabilities: {
          claudeSubscription: true,
          claudeDirectAuth: false,
          claudeBare: false,
          codexSkipGitRepoCheck: false,
          claudeVersion: "2.1.0",
          codexVersion: null
        }
      })
    )
    expect(harness.hub.connected("claude-cli")).toBeTrue()
    const events = harness.hub.stream({ provider: "claude-cli", model: "sonnet", prompt: "p" })
    const collecting = (async () => {
      const result = []
      for await (const event of events) result.push(event)
      return result
    })()
    await Promise.resolve()
    const claim = JSON.parse(harness.sent.at(-1) ?? "{}") as {
      runId: string
      leaseId: string
    }
    const base = { version: 1, runId: claim.runId, leaseId: claim.leaseId }
    await harness.hub.message(harness.socket, JSON.stringify({ ...base, type: "ack" }))
    await harness.hub.message(
      harness.socket,
      JSON.stringify({
        ...base,
        type: "output",
        sequence: 1,
        stream: "stdout",
        chunk: JSON.stringify({
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } }
        })
      })
    )
    await harness.hub.message(
      harness.socket,
      JSON.stringify({ ...base, type: "completion", exitCode: 0, outputHash: "b".repeat(64) })
    )
    expect(await collecting).toEqual([{ kind: "text", text: "hi" }])
  })

  test("restores persisted capabilities and reclaims an interrupted lease without duplicate output", async () => {
    const harness = setup()
    const invitation = harness.pairing.issueCode()
    await harness.hub.message(
      harness.socket,
      JSON.stringify({
        version: RUNNER_PROTOCOL_VERSION,
        type: "pair_request",
        runnerName: "codex-only",
        pairingCode: invitation.code,
        capabilities: {
          claudeSubscription: false,
          claudeDirectAuth: false,
          claudeBare: false,
          codexSkipGitRepoCheck: true,
          claudeVersion: null,
          codexVersion: "1.0.0"
        }
      })
    )
    const credentials = JSON.parse(harness.sent.at(-1) ?? "{}") as {
      runnerId: string
      token: string
    }
    expect(harness.hub.connected("claude-cli")).toBeFalse()

    const collecting = (async () => {
      const result = []
      for await (const event of harness.hub.stream({
        provider: "codex-cli",
        model: "gpt-test",
        prompt: "p"
      }))
        result.push(event)
      return result
    })()
    await Promise.resolve()
    const claim = JSON.parse(harness.sent.at(-1) ?? "{}") as {
      runId: string
      leaseId: string
    }
    harness.hub.close(harness.socket)

    const resent: string[] = []
    const reconnected: HubSocket = {
      data: { runnerId: null, capabilities: new Set() },
      send: (message) => resent.push(message),
      close() {}
    }
    harness.hub.open(reconnected)
    await harness.hub.message(
      reconnected,
      JSON.stringify({
        version: RUNNER_PROTOCOL_VERSION,
        type: "authenticate",
        runnerId: credentials.runnerId,
        token: credentials.token,
        nonce: "n".repeat(16)
      })
    )
    expect(harness.hub.connected("claude-cli")).toBeFalse()
    expect(JSON.parse(resent[0] ?? "{}").runId).toBe(claim.runId)

    const base = { version: 1, runId: claim.runId, leaseId: claim.leaseId }
    const line = `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hi" } })}\n`
    const first = {
      ...base,
      type: "output",
      sequence: 1,
      stream: "stdout",
      chunk: line.slice(0, 20)
    }
    await harness.hub.message(reconnected, JSON.stringify(first))
    await harness.hub.message(reconnected, JSON.stringify(first))
    await harness.hub.message(
      reconnected,
      JSON.stringify({
        ...base,
        type: "output",
        sequence: 2,
        stream: "stdout",
        chunk: line.slice(20)
      })
    )
    await harness.hub.message(
      reconnected,
      JSON.stringify({ ...base, type: "completion", exitCode: 0, outputHash: "c".repeat(64) })
    )
    expect(await collecting).toEqual([{ kind: "text", text: "hi" }])
  })

  test("disconnects a revoked runner and fails its active stream", async () => {
    const harness = setup()
    let closeReason = ""
    harness.socket.close = (_code, reason) => {
      closeReason = reason ?? ""
    }
    const invitation = harness.pairing.issueCode()
    await harness.hub.message(
      harness.socket,
      JSON.stringify({
        version: RUNNER_PROTOCOL_VERSION,
        type: "pair_request",
        runnerName: "revoked-runner",
        pairingCode: invitation.code,
        capabilities: {
          claudeSubscription: true,
          claudeDirectAuth: false,
          claudeBare: false,
          codexSkipGitRepoCheck: false,
          claudeVersion: "2.1.0",
          codexVersion: null
        }
      })
    )
    const accepted = JSON.parse(harness.sent.at(-1) ?? "{}") as { runnerId: string }
    const collecting = (async () => {
      for await (const event of harness.hub.stream({
        provider: "claude-cli",
        model: "sonnet",
        prompt: "p"
      })) {
        // No output is expected before revocation.
        void event
      }
    })()
    await Promise.resolve()

    harness.pairing.revoke("revoked-runner")
    harness.hub.revoke(accepted.runnerId)

    expect(harness.hub.connected("claude-cli")).toBeFalse()
    expect(closeReason).toBe("runner_revoked")
    await expect(collecting).rejects.toThrow("RUNNER_HUB_RUNNER_REVOKED")
  })
})
