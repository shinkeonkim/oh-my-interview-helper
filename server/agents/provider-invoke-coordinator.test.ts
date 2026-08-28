import { expect, test } from "bun:test"

import { ProviderInvokeCoordinator } from "../src/agents/provider-invoke-coordinator"

test("keeps an outcome reported before its terminal hook", () => {
  // Given
  const coordinator = new ProviderInvokeCoordinator<string>()
  coordinator.register("job")

  // When
  coordinator.report("job", "succeeded")

  // Then
  expect(coordinator.take("job")).toBe("succeeded")
  expect(coordinator.size).toBe(0)
})

test("discards a late outcome after an abort terminal hook", () => {
  // Given
  const coordinator = new ProviderInvokeCoordinator<string>()
  coordinator.register("job")

  // When
  expect(coordinator.take("job")).toBeUndefined()
  coordinator.report("job", "late-success")

  // Then
  expect(coordinator.size).toBe(0)
  expect(coordinator.take("job")).toBeUndefined()
})
