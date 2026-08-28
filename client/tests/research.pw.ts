import { expect, test } from "@playwright/test"

test("creates cited research, distinguishes judgments, and refreshes its history", async ({
  page
}) => {
  const sourceId = "11111111-1111-4111-8111-111111111111"
  const firstId = "22222222-2222-4222-8222-222222222222"
  const refreshedId = "33333333-3333-4333-8333-333333333333"
  const createdAt = "2026-08-28T00:00:00.000Z"
  let records: Array<Record<string, unknown>> = []
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
      fitAssessment: {
        label: "advisory",
        summary: "공개 근거를 검토한 뒤 판단하세요.",
        strengths: [],
        risks: []
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
    if (route.request().method() === "POST") records = [record(firstId, null)]
    await route.fulfill({
      status: route.request().method() === "POST" ? 201 : 200,
      json: route.request().method() === "POST" ? records[0] : { records }
    })
  })
  await page.route("**/api/research/*/refresh", async (route) => {
    const refreshed = record(refreshedId, firstId)
    records = [refreshed, ...records]
    await route.fulfill({ status: 201, json: refreshed })
  })
  await page.route("**/api/research/*", (route) => route.fulfill({ json: records[0] }))

  await page.goto("/job-search")
  await page.getByRole("combobox").click()
  await page.getByRole("option", { name: "팀 리드" }).click()
  await page.getByText("이름 또는 회사명").locator("..").getByRole("textbox").fill("Kim")
  await page.getByText("소속 회사").locator("..").getByRole("textbox").fill("Acme")
  await page.getByText("역할 단서").locator("..").getByRole("textbox").fill("Platform")
  await page
    .getByText("공개 출처 URL")
    .locator("..")
    .getByRole("textbox")
    .fill("https://example.com/profile")
  await page.getByRole("button", { name: "리서치 시작" }).click()

  await expect(page.getByText("동명이인 가능성").first()).toBeVisible()
  await expect(page.getByText("사실", { exact: true })).toBeVisible()
  await expect(page.getByText("추론", { exact: true })).toBeVisible()
  await expect(page.getByText("참고용 조언", { exact: false })).toBeVisible()
  await expect(page.getByRole("link", { name: /Acme public profile/ }).first()).toHaveAttribute(
    "href",
    "https://example.com/profile"
  )

  await page.getByRole("button", { name: "새 출처로 갱신" }).click()
  await expect(page.getByText("Kim · 동명이인 가능성")).toHaveCount(2)
})
