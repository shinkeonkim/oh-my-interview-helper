import { expect, test } from "bun:test"

import * as agents from "../src/agents"

test("keeps deterministic test doubles out of the production agents barrel", () => {
  // Given / When / Then
  expect(agents).not.toHaveProperty("FakeModel")
  expect(agents).not.toHaveProperty("FakeModelProbe")
  expect(agents).not.toHaveProperty("registration")
  expect(agents).not.toHaveProperty("kernelFor")
})
