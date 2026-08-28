import { expect, test } from "@playwright/test"

test("enables a fixed provider model and issues a one-use runner pairing code", async ({
  page
}) => {
  let configured = false
  let savedBody: unknown = null
  let csrfHeader = ""
  let runnerStatus = "active"
  await page.route("**/api/security/csrf", (route) =>
    route.fulfill({ json: { csrfToken: "csrf-token" } })
  )
  await page.route("**/api/providers/status", (route) =>
    route.fulfill({
      json: {
        providers: [
          {
            id: "anthropic-api",
            mode: "api",
            model: { id: "claude-sonnet", displayName: "Claude Sonnet" },
            capabilities: {
              generation: true,
              structuredOutput: true,
              citedResearch: false
            },
            configured,
            health: { kind: "not_checked" }
          }
        ]
      }
    })
  )
  await page.route("**/api/settings/providers/anthropic-api", async (route) => {
    savedBody = route.request().postDataJSON()
    csrfHeader = route.request().headers()["x-csrf-token"] ?? ""
    configured = true
    await route.fulfill({ json: { providerKind: "anthropic-api", enabled: true } })
  })
  await page.route("**/api/runners/pairing-code", async (route) => {
    expect(route.request().headers()["x-csrf-token"]).toBe("csrf-token")
    await route.fulfill({
      status: 201,
      json: { code: "AB12CD34", expiresAt: "2026-08-28T12:05:00.000Z" }
    })
  })
  await page.route("**/api/runners/desk-runner", async (route) => {
    expect(route.request().method()).toBe("DELETE")
    expect(route.request().headers()["x-csrf-token"]).toBe("csrf-token")
    runnerStatus = "revoked"
    await route.fulfill({ status: 204 })
  })
  await page.route("**/api/runners", (route) =>
    route.fulfill({
      json: {
        runners: [
          {
            runnerName: "desk-runner",
            capabilities: {
              claudeVersion: "claude 1.2.3",
              codexVersion: "codex 1.2.3"
            },
            status: runnerStatus,
            lastSeenAt: "2026-08-28T12:00:00.000Z"
          }
        ]
      }
    })
  )

  await page.goto("/settings")
  await expect(page.getByText("anthropic-api")).toBeVisible()
  await expect(page.getByText("Claude Sonnet · claude-sonnet")).toBeVisible()
  await page.getByRole("button", { name: "사용 설정" }).click()
  await expect(page.getByText("사용 중", { exact: true })).toBeVisible()
  expect(csrfHeader).toBe("csrf-token")
  expect(savedBody).toEqual({
    selectedModel: "claude-sonnet",
    enabled: true,
    capabilities: {
      generation: true,
      structuredOutput: true,
      citedResearch: false
    }
  })

  await page.getByRole("button", { name: "연결 코드 발급" }).click()
  await expect(page.getByText("AB12CD34")).toBeVisible()
  await expect(page.getByText("일회용 연결 코드")).toBeVisible()
  await expect(page.getByLabel(/API|키|token/i)).toHaveCount(0)

  await expect(page.getByText("desk-runner")).toBeVisible()
  await expect(page.getByText("claude 1.2.3 · codex 1.2.3")).toBeVisible()
  await page.getByRole("button", { name: "연결 해제" }).click()
  await expect(page.getByText("해제됨")).toBeVisible()
  await expect(page.getByRole("button", { name: "연결 해제" })).toHaveCount(0)
})
