import { expect, test } from "bun:test"
import { z } from "zod"

import { ToolIdSchema, ToolRegistry, collectProviderStream } from "../src/agents"
import { kernelFor, registration, request, structuredSchema } from "./contract-support"

test("cancels before model construction, during streaming, and during structured repair", async () => {
  const before = registration([{ kind: "text", chunks: ["never"] }])
  const beforeController = new AbortController()
  beforeController.abort("cancelled")
  const beforeResult = await collectProviderStream(
    kernelFor(before.registration).stream({ ...request, signal: beforeController.signal })
  )
  expect(beforeResult.result).toMatchObject({ kind: "cancelled" })
  expect(before.probe.callCount).toBe(0)

  const stream = registration([{ kind: "hang" }])
  const streamController = new AbortController()
  const streamPromise = collectProviderStream(
    kernelFor(stream.registration).stream({ ...request, signal: streamController.signal })
  )
  await stream.probe.waitForCalls(1)
  streamController.abort("cancelled")
  expect((await streamPromise).result).toMatchObject({ kind: "cancelled" })

  const repair = registration([{ kind: "structured", value: { answer: 1 } }, { kind: "hang" }])
  const repairController = new AbortController()
  const repairPromise = collectProviderStream(
    kernelFor(repair.registration).stream({
      ...request,
      output: { kind: "structured", schema: structuredSchema },
      signal: repairController.signal
    })
  )
  await repair.probe.waitForCalls(2)
  repairController.abort("cancelled")
  expect((await repairPromise).result).toMatchObject({ kind: "cancelled" })
})

test("times out a hanging model and forwards cancellation to an approved validated tool", async () => {
  const timeout = registration([{ kind: "hang" }])
  const timeoutResult = await collectProviderStream(
    kernelFor(timeout.registration).stream({ ...request, timeoutMilliseconds: 10 })
  )
  expect(timeoutResult.result).toMatchObject({ kind: "failed", error: { code: "timeout" } })

  let entered = false
  let aborted = false
  const tool = new ToolRegistry([
    {
      id: ToolIdSchema.parse("echo"),
      schema: z.object({ value: z.string() }),
      execute: (_input, context) =>
        new Promise((resolve) => {
          entered = true
          context.signal.addEventListener(
            "abort",
            () => {
              aborted = true
              resolve({ value: "cancelled" })
            },
            { once: true }
          )
        })
    }
  ])
  const fake = registration([{ kind: "tool", name: "echo", input: { value: "ok" } }])
  const controller = new AbortController()
  const pending = collectProviderStream(
    kernelFor(fake.registration, tool).stream({
      ...request,
      toolIds: ["echo"],
      signal: controller.signal
    })
  )
  await fake.probe.waitForCalls(1)
  while (!entered) await Promise.resolve()
  controller.abort("cancelled")
  expect((await pending).result).toMatchObject({ kind: "cancelled" })
  expect(aborted).toBe(true)
})
