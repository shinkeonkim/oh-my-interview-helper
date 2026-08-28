import { expect, test } from "@playwright/test"

test("summarizes only persisted local activity and job states", async ({ page }) => {
  let jobsRequestCount = 0
  let cancelCsrfToken: string | undefined
  let runningState = "running"
  await page.route("**/api/postings", (route) =>
    route.fulfill({ json: { postings: [{ id: "one" }, { id: "two" }] } })
  )
  await page.route("**/api/applications", (route) =>
    route.fulfill({
      json: {
        applications: [
          { id: "one", stageName: "Applied" },
          { id: "two", stageName: "Interviewing" },
          { id: "three", stageName: "Interviewing" }
        ]
      }
    })
  )
  await page.route("**/api/documents", (route) =>
    route.fulfill({
      json: {
        documents: [
          { id: "one", state: "active" },
          { id: "two", state: "active" },
          { id: "three", state: "archived" }
        ]
      }
    })
  )
  await page.route("**/api/security/csrf", (route) =>
    route.fulfill({ json: { csrfToken: "stats-csrf-token" } })
  )
  await page.route("**/api/jobs/22222222-2222-4222-8222-222222222222/cancel", (route) => {
    cancelCsrfToken = route.request().headers()["x-csrf-token"]
    runningState = "cancelled"
    return route.fulfill({
      json: {
        id: "22222222-2222-4222-8222-222222222222",
        kind: "provider.invoke",
        state: runningState,
        updatedAt: "2026-08-28T09:01:00.000Z"
      }
    })
  })
  await page.route("**/api/jobs", (route) => {
    jobsRequestCount += 1
    return route.fulfill({
      json: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          kind: "research.company",
          state: "succeeded",
          updatedAt: "2026-08-28T08:00:00.000Z"
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          kind: "provider.invoke",
          state: runningState,
          updatedAt: "2026-08-28T09:00:00.000Z"
        }
      ]
    })
  })

  await page.goto("/stats")
  await expect(page.getByRole("heading", { name: "통계" })).toBeVisible()
  const summary = page.getByRole("region", { name: "주요 통계" })
  await expect(summary.getByText("채용공고").locator("../..")).toContainText("2")
  await expect(summary.getByText("지원서").locator("../..")).toContainText("3")
  await expect(summary.getByText("활성 문서").locator("../..")).toContainText("2")
  await expect(summary.getByText("작업 기록").locator("../..")).toContainText("2")
  await expect(page.getByText("Interviewing").locator("..")).toContainText("2")
  await expect(page.getByText("실행 중 · 1")).toBeVisible()
  await expect(page.getByText("완료 · 1")).toBeVisible()
  await expect(page.getByText("provider.invoke")).toBeVisible()

  const requestsBeforeRefresh = jobsRequestCount
  await page.getByRole("button", { name: "새로고침" }).click()
  await expect.poll(() => jobsRequestCount).toBeGreaterThan(requestsBeforeRefresh)

  await page.getByRole("button", { name: "작업 취소" }).click()
  await expect(page.getByText("취소 · 1")).toBeVisible()
  await expect(page.getByText("실행 중 · 1")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "작업 취소" })).toHaveCount(0)
  expect(cancelCsrfToken).toBe("stats-csrf-token")
})
