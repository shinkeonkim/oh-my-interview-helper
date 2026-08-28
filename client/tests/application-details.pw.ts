import { expect, test } from "@playwright/test"

test("keeps the latest posting version and application history selection", async ({ page }) => {
  const posts = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      title: "First role",
      companyName: "First company",
      teamName: null,
      state: "active",
      versionNumber: 1,
      sourceKind: "manual",
      canonicalUrl: null,
      metadata: {}
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      title: "Second role",
      companyName: "Second company",
      teamName: null,
      state: "active",
      versionNumber: 2,
      sourceKind: "url",
      canonicalUrl: "https://jobs.example.com/second",
      metadata: {}
    }
  ]
  const stage = {
    id: "33333333-3333-4333-8333-333333333333",
    key: "saved",
    name: "Saved",
    position: 1,
    outcome: null,
    system: true
  }
  const applications = posts.map((post, index) => ({
    id: `${index + 4}4444444-4444-4444-8444-444444444444`,
    jobPostId: post.id,
    stageId: stage.id,
    stageName: stage.name,
    appliedAt: null,
    outcomeAt: null,
    archivedAt: null
  }))
  const firstPost = posts[0]
  const firstApplication = applications[0]
  if (firstPost === undefined || firstApplication === undefined) throw new Error("fixture missing")

  await page.route("**/api/postings", (route) => route.fulfill({ json: { postings: posts } }))
  await page.route("**/api/applications", (route) => route.fulfill({ json: { applications } }))
  await page.route("**/api/pipeline/stages", (route) =>
    route.fulfill({ json: { stages: [stage] } })
  )
  await page.route(/\/api\/postings\/[^/]+\/versions$/, async (route) => {
    const first = route.request().url().includes(firstPost.id)
    await new Promise((resolve) => setTimeout(resolve, first ? 200 : 20))
    await route.fulfill({
      json: {
        versions: [
          {
            id: first
              ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
              : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            versionNumber: first ? 1 : 2,
            sourceKind: first ? "manual" : "url",
            createdAt: "2026-08-29T00:00:00.000Z"
          }
        ]
      }
    })
  })
  await page.route(/\/api\/applications\/[^/]+\/history$/, async (route) => {
    const first = route.request().url().includes(firstApplication.id)
    await new Promise((resolve) => setTimeout(resolve, first ? 200 : 20))
    await route.fulfill({
      json: {
        events: [
          {
            id: first
              ? "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
              : "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            sequence: 1,
            kind: "note_added",
            payload: { text: first ? "First history" : "Second history" },
            createdAt: "2026-08-29T00:00:00.000Z"
          }
        ],
        interviews: []
      }
    })
  })

  await page.goto("/jobs")

  const versionButtons = page.getByRole("button", { name: "버전 기록" })
  await versionButtons.nth(0).click()
  await versionButtons.nth(1).click()
  await expect(page.getByText("Second role · 버전 기록")).toBeVisible()
  await page.waitForTimeout(250)
  await expect(page.getByText("Second role · 버전 기록")).toBeVisible()
  await expect(page.getByText("First role · 버전 기록")).toHaveCount(0)

  const updateUrl = page.getByLabel("갱신할 공개 공고 URL")
  await updateUrl.fill("javascript:alert(1)")
  await expect(page.getByRole("button", { name: "새 버전 수집" })).toBeDisabled()

  const historyButtons = page.getByRole("button", { name: "전체 이력" })
  await historyButtons.nth(0).click()
  await historyButtons.nth(1).click()
  await expect(page.getByText("Second history")).toBeVisible()
  await page.waitForTimeout(250)
  await expect(page.getByText("Second history")).toBeVisible()
  await expect(page.getByText("First history")).toHaveCount(0)
})
