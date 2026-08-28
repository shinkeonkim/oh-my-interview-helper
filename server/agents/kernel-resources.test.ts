import { expect, test } from "bun:test"

import { collectProviderStream } from "../src/agents"
import { kernelFor, registration, request } from "./contract-support"

const activeTimeouts = (): number =>
  process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length

test("returns to the baseline active timeout count after the timeout window", async () => {
  // Given
  const baseline = activeTimeouts()
  const kernel = kernelFor(registration([{ kind: "hang" }]).registration)

  // When
  const completed = await collectProviderStream(
    kernel.stream({ ...request, timeoutMilliseconds: 5 })
  )
  await Bun.sleep(15)

  // Then
  expect(completed.result).toMatchObject({ kind: "failed", error: { code: "timeout" } })
  expect(activeTimeouts()).toBe(baseline)
})
