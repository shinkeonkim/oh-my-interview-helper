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
  await page.route("**/api/stats/overview", (route) =>
    route.fulfill({
      json: {
        uptime: { since: "2026-08-28T00:00:00.000Z", milliseconds: 3_900_000 },
        memory: { rssMb: 120, heapUsedMb: 40, heapTotalMb: 80, externalMb: 2 },
        counts: { research: 4, messages: 7, artifacts: 3, interviews: 2 },
        providerRuns: {
          total: 6,
          tokens: { input: 100, output: 200, cache: 300 },
          byKind: [{ kind: "interview_brief", count: 2, outputTokens: 200 }],
          states: [{ provider: "claude-cli", status: "succeeded", count: 6 }]
        }
      }
    })
  )
  await page.route(
    "**/api/jobs/22222222-2222-4222-8222-222222222222/events?transport=poll",
    (route) =>
      route.fulfill({
        json: {
          events: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              jobId: "22222222-2222-4222-8222-222222222222",
              sequence: 1,
              kind: "enqueued",
              payload: { state: "queued" },
              createdAt: "2026-08-28T08:59:00.000Z"
            },
            {
              id: "44444444-4444-4444-8444-444444444444",
              jobId: "22222222-2222-4222-8222-222222222222",
              sequence: 2,
              kind: "started",
              payload: { state: "running" },
              createdAt: "2026-08-28T09:00:00.000Z"
            }
          ]
        }
      })
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
  await expect(page.getByText("AI Provider 실행")).toBeVisible()
  await expect(page.getByText("1h 5m")).toBeVisible()
  await expect(page.getByText("interview_brief")).toBeVisible()

  await page.getByRole("button", { name: "이벤트 보기" }).first().click()
  const eventHistory = page.getByLabel("작업 이벤트 이력")
  await expect(eventHistory).toContainText("#1 · enqueued")
  await expect(eventHistory).toContainText("#2 · started")
  await expect(eventHistory).not.toContainText('queued":')

  const requestsBeforeRefresh = jobsRequestCount
  await page.getByRole("button", { name: "새로고침" }).click()
  await expect.poll(() => jobsRequestCount).toBeGreaterThan(requestsBeforeRefresh)

  await page.getByRole("button", { name: "작업 취소" }).click()
  await expect(page.getByText("취소 · 1")).toBeVisible()
  await expect(page.getByText("실행 중 · 1")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "작업 취소" })).toHaveCount(0)
  expect(cancelCsrfToken).toBe("stats-csrf-token")
})

test("과거 handler_missing 기록을 현재 수정된 이전 버전 오류로 설명한다", async ({ page }) => {
  await page.route("**/api/postings", (route) => route.fulfill({ json: { postings: [] } }))
  await page.route("**/api/applications", (route) => route.fulfill({ json: { applications: [] } }))
  await page.route("**/api/documents", (route) => route.fulfill({ json: { documents: [] } }))
  await page.route("**/api/jobs", (route) =>
    route.fulfill({
      json: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          kind: "ui.research",
          state: "failed",
          errorCode: "handler_missing",
          errorMessage: "Job handler is unavailable",
          payload: {},
          updatedAt: "2026-08-31T15:14:55.639Z"
        }
      ]
    })
  )
  await page.route("**/api/stats/overview", (route) =>
    route.fulfill({
      json: {
        uptime: { since: "2026-09-01T00:00:00.000Z", milliseconds: 0 },
        memory: { rssMb: 0, heapUsedMb: 0, heapTotalMb: 0, externalMb: 0 },
        counts: {},
        providerRuns: {
          total: 0,
          tokens: { input: 0, output: 0, cache: 0 },
          byKind: [],
          states: []
        }
      }
    })
  )

  await page.goto("/stats")
  await expect(page.getByText("이전 버전의 작업 등록 오류 · 현재 수정됨")).toBeVisible()
  await expect(page.getByText("handler_missing")).toHaveCount(0)
})
