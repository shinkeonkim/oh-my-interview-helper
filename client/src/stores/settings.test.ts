import { describe, expect, test } from "bun:test"

import { resolveLocale } from "../locales"
import { resolveTheme } from "./settings"

describe("preference boundary recovery", () => {
  test("falls back to Korean for an unknown locale", () => {
    expect(resolveLocale("fr")).toBe("ko")
  })

  test("falls back to system for an unknown theme", () => {
    expect(resolveTheme({ corrupted: true })).toBe("system")
  })
})
