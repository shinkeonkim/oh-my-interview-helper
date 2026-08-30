import { expect, test } from "@playwright/test"

test("creates cited research, distinguishes judgments, and refreshes its history", async ({
  page
}) => {
  const sourceId = "11111111-1111-4111-8111-111111111111"
  const firstId = "22222222-2222-4222-8222-222222222222"
  const refreshedId = "33333333-3333-4333-8333-333333333333"
  const createdAt = "2026-08-28T00:00:00.000Z"
  let records: Array<Record<string, unknown>> = []
  let runRequests = 0
  let refreshRequests = 0
  const record = (id: string, parentRecordId: string | null) => ({
    id,
    jobPostId: null,
    subjectType: "team_lead",
    subjectName: "Kim",
    parentRecordId,
    identityStatus: "ambiguous",
    identityCandidates: [
      { name: "Kim", role: "Platform", organization: "Acme", sourceIds: [sourceId] }
    ],
    analysis: {
      summary: {
        career: ["Platform engineering experience"],
        stack: ["TypeScript"],
        projects: ["Atlas migration"]
      },
      fitAssessment: {
        label: "advisory",
        summary: "공개 근거를 검토한 뒤 판단하세요.",
        strengths: ["TypeScript overlap"],
        risks: ["신원을 직접 확인해야 합니다."]
      }
    },
    claims: [
      {
        id: crypto.randomUUID(),
        statement: "Acme가 공개 프로필을 제공합니다.",
        classification: "fact",
        sourceIds: [sourceId],
        confidence: "high"
      },
      {
        id: crypto.randomUUID(),
        statement: "플랫폼 경험과 관련이 있을 수 있습니다.",
        classification: "inference",
        sourceIds: [sourceId],
        confidence: "medium"
      }
    ],
    sources: [
      {
        id: sourceId,
        url: "https://example.com/profile",
        title: "Acme public profile",
        excerpt: "Public professional evidence",
        status: "available"
      }
    ],
    createdAt
  })
  await page.route("**/api/security/csrf", (route) =>
    route.fulfill({ json: { csrfToken: "token" } })
  )
  await page.route("**/api/research", async (route) => {
    if (route.request().method() === "POST") {
      runRequests += 1
      records = [record(firstId, null)]
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    await route.fulfill({
      status: route.request().method() === "POST" ? 201 : 200,
      json: route.request().method() === "POST" ? records[0] : { records }
    })
  })
  await page.route("**/api/research/*/refresh", async (route) => {
    refreshRequests += 1
    const refreshed = record(refreshedId, firstId)
    records = [refreshed, ...records]
    await new Promise((resolve) => setTimeout(resolve, 100))
    await route.fulfill({ status: 201, json: refreshed })
  })
  await page.route("**/api/research/*", (route) => route.fulfill({ json: records[0] }))

  await page.goto("/research")
  const runButton = page.getByRole("button", { name: "리서치 시작" })
  await expect(runButton).toBeDisabled()
  await page.getByLabel("대상 유형").click()
  await page.getByRole("option", { name: "팀 리드" }).click()
  await page.getByLabel("이름 또는 회사명").fill("Kim")
  await page.getByLabel("소속 회사").fill("Acme")
  await page.getByLabel("역할 단서").fill("Platform")
  const sourceInput = page.getByLabel("추가로 참고할 공개 URL (선택)")
  await expect(runButton).toBeEnabled()
  await sourceInput.fill("ftp://example.com/profile")
  await expect(runButton).toBeDisabled()
  await sourceInput.fill("https://example.com/profile")
  await expect(runButton).toBeEnabled()
  await runButton.click()
  await expect(runButton).toBeDisabled()
  await expect(sourceInput).toBeDisabled()

  await expect(page.getByText("동명이인 가능성").first()).toBeVisible()
  await expect(page.getByText("사실", { exact: true })).toBeVisible()
  await expect(page.getByText("추론", { exact: true })).toBeVisible()
  await expect(page.getByText("경력 근거", { exact: true })).toBeVisible()
  await expect(page.getByText("Platform engineering experience")).toBeVisible()
  await expect(page.getByText("기술 스택", { exact: true })).toBeVisible()
  await expect(page.getByText("TypeScript", { exact: true })).toBeVisible()
  await expect(page.getByText("프로젝트 경험", { exact: true })).toBeVisible()
  await expect(page.getByText("Atlas migration")).toBeVisible()
  await expect(page.getByText("TypeScript overlap")).toBeVisible()
  await expect(page.getByText("신원을 직접 확인해야 합니다.")).toBeVisible()
  await expect(page.getByText("참고용 조언", { exact: false })).toBeVisible()
  await expect(page.getByRole("link", { name: /Acme public profile/ }).first()).toHaveAttribute(
    "href",
    "https://example.com/profile"
  )
  expect(runRequests).toBe(1)

  const refreshButton = page.getByRole("button", { name: "새 출처로 갱신" })
  await refreshButton.click()
  await expect(refreshButton).toBeDisabled()
  await expect(page.getByText("Kim · 동명이인 가능성")).toHaveCount(2)
  expect(refreshRequests).toBe(1)
})

test("keeps the latest research record selection", async ({ page }) => {
  const summaries = [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      subjectType: "company",
      subjectName: "First subject",
      parentRecordId: null,
      identityStatus: "confirmed",
      createdAt: "2026-08-29T00:00:00.000Z"
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      subjectType: "company",
      subjectName: "Second subject",
      parentRecordId: null,
      identityStatus: "confirmed",
      createdAt: "2026-08-29T01:00:00.000Z"
    }
  ]
  await page.route("**/api/research", (route) => route.fulfill({ json: { records: summaries } }))
  await page.route(/\/api\/research\/[^/]+$/, async (route) => {
    const first = route
      .request()
      .url()
      .includes(summaries[0]?.id ?? "")
    await new Promise((resolve) => setTimeout(resolve, first ? 200 : 20))
    const summary = first ? summaries[0] : summaries[1]
    if (summary === undefined) throw new Error("fixture missing")
    await route.fulfill({
      json: {
        ...summary,
        identityCandidates: [],
        analysis: {
          summary: { career: [], stack: [], projects: [] },
          fitAssessment: {
            label: "advisory",
            summary: first ? "First assessment" : "Second assessment",
            strengths: [],
            risks: []
          }
        },
        claims: [],
        sources: []
      }
    })
  })

  await page.goto("/research")
  await page.getByRole("button", { name: /First subject/ }).click()
  await page.getByRole("button", { name: /Second subject/ }).click()
  await expect(page.getByText("Second assessment")).toBeVisible()
  await page.waitForTimeout(250)
  await expect(page.getByText("Second assessment")).toBeVisible()
  await expect(page.getByText("First assessment")).toHaveCount(0)
})
