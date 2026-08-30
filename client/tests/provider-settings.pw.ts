import { expect, test } from "@playwright/test"

test("enables a fixed provider model and issues a one-use runner pairing code", async ({
  page
}) => {
  let configured = false
  let savedBody: unknown = null
  let csrfHeader = ""
  let runnerStatus = "active"
  let providerRequests = 0
  let pairingRequests = 0
  let revokeRequests = 0
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
    providerRequests += 1
    savedBody = route.request().postDataJSON()
    csrfHeader = route.request().headers()["x-csrf-token"] ?? ""
    configured = true
    await new Promise((resolve) => setTimeout(resolve, 100))
    await route.fulfill({ json: { providerKind: "anthropic-api", enabled: true } })
  })
  await page.route("**/api/runners/pairing-code", async (route) => {
    pairingRequests += 1
    expect(route.request().headers()["x-csrf-token"]).toBe("csrf-token")
    await new Promise((resolve) => setTimeout(resolve, 100))
    await route.fulfill({
      status: 201,
      json: { code: "AB12CD34", expiresAt: "2026-08-28T12:05:00.000Z" }
    })
  })
  await page.route("**/api/runners/desk-runner", async (route) => {
    revokeRequests += 1
    expect(route.request().method()).toBe("DELETE")
    expect(route.request().headers()["x-csrf-token"]).toBe("csrf-token")
    runnerStatus = "revoked"
    await new Promise((resolve) => setTimeout(resolve, 100))
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
  const providerButton = page.getByRole("button", { name: "사용 설정" })
  await providerButton.click()
  await expect(providerButton).toBeDisabled()
  await expect(page.getByText("사용 중", { exact: true })).toBeVisible()
  expect(providerRequests).toBe(1)
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

  const pairingButton = page.getByRole("button", { name: "연결 코드 발급" })
  await pairingButton.click()
  await expect(pairingButton).toBeDisabled()
  await expect(page.getByText("AB12CD34")).toBeVisible()
  expect(pairingRequests).toBe(1)
  await expect(page.getByText("일회용 연결 코드")).toBeVisible()
  await expect(page.getByLabel(/API|키|token/i)).toHaveCount(0)

  await expect(page.getByText("desk-runner")).toBeVisible()
  await expect(page.getByText("claude 1.2.3 · codex 1.2.3")).toBeVisible()
  const revokeButton = page.getByRole("button", { name: "연결 해제" })
  await revokeButton.click()
  await expect(revokeButton).toBeDisabled()
  await expect(page.getByText("해제됨")).toBeVisible()
  await expect(page.getByRole("button", { name: "연결 해제" })).toHaveCount(0)
  expect(revokeRequests).toBe(1)
})

test("keeps the latest provider list after overlapping setting changes", async ({ page }) => {
  const configured = new Map([
    ["anthropic-api", false],
    ["openai-api", false]
  ])
  const descriptors = [
    {
      id: "anthropic-api",
      mode: "api",
      model: { id: "claude-sonnet", displayName: "Claude Sonnet" },
      capabilities: { generation: true },
      health: { kind: "not_checked" }
    },
    {
      id: "openai-api",
      mode: "api",
      model: { id: "gpt-5", displayName: "GPT-5" },
      capabilities: { generation: true },
      health: { kind: "not_checked" }
    }
  ]
  let providerListRequests = 0

  await page.route("**/api/security/csrf", (route) =>
    route.fulfill({ json: { csrfToken: "csrf-token" } })
  )
  await page.route("**/api/providers/status", async (route) => {
    providerListRequests += 1
    const providers = descriptors.map((provider) => ({
      ...provider,
      configured: configured.get(provider.id) ?? false
    }))
    if (providerListRequests === 2) await new Promise((resolve) => setTimeout(resolve, 400))
    if (providerListRequests === 3) await new Promise((resolve) => setTimeout(resolve, 20))
    await route.fulfill({ json: { providers } })
  })
  await page.route("**/api/settings/providers/*", async (route) => {
    const id = route.request().url().split("/").at(-1) ?? ""
    await new Promise((resolve) => setTimeout(resolve, id === "anthropic-api" ? 300 : 500))
    configured.set(id, true)
    await route.fulfill({ json: { providerKind: id, enabled: true } })
  })
  await page.route("**/api/runners", (route) => route.fulfill({ json: { runners: [] } }))

  await page.goto("/settings")
  const enableButtons = page.getByRole("button", { name: "사용 설정" })
  await expect(enableButtons).toHaveCount(2)
  await enableButtons.nth(0).click()
  await enableButtons.nth(1).click()

  await expect.poll(() => providerListRequests).toBe(3)
  await page.waitForTimeout(450)
  await expect(page.getByRole("button", { name: "사용 중지" })).toHaveCount(2)
})
