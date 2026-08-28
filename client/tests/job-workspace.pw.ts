import { expect, test } from "@playwright/test"

test("deep-links all seven job workspace areas while preserving job context", async ({ page }) => {
  test.setTimeout(20_000)
  const postId = "11111111-1111-4111-8111-111111111111"
  const versionId = "22222222-2222-4222-8222-222222222222"
  const applicationId = "33333333-3333-4333-8333-333333333333"
  const posting = {
    id: postId,
    title: "Backend Engineer",
    companyName: "Acme",
    teamName: "Platform",
    currentVersionId: versionId,
    versionNumber: 4
  }
  await page.route("**/api/postings", (route) => route.fulfill({ json: { postings: [posting] } }))
  await page.route("**/api/applications", (route) =>
    route.fulfill({
      json: {
        applications: [
          {
            id: applicationId,
            jobPostId: postId,
            stageName: "Interviewing",
            appliedAt: "2026-08-27T00:00:00.000Z"
          }
        ]
      }
    })
  )
  await page.route(`**/api/applications/${applicationId}/history`, (route) =>
    route.fulfill({
      json: {
        events: [],
        interviews: [
          {
            id: crypto.randomUUID(),
            kind: "Technical",
            scheduledAt: "2026-09-01T03:00:00.000Z"
          }
        ]
      }
    })
  )
  await page.route("**/api/documents", (route) => route.fulfill({ json: { documents: [] } }))
  await page.route("**/api/providers/status", (route) => route.fulfill({ json: { providers: [] } }))
  await page.route(/\/api\/conversations\?applicationId=/, (route) =>
    route.fulfill({ json: { conversations: [] } })
  )
  await page.route("**/api/research**", (route) => route.fulfill({ json: { records: [] } }))

  await page.goto(`/jobs/${postId}`)
  await expect(page).toHaveURL(new RegExp(`/jobs/${postId}/overview$`))
  await expect(page.getByRole("heading", { name: posting.title })).toBeVisible()
  await expect(page.getByText("Interviewing")).toBeVisible()
  await expect(page.getByText(/Technical/)).toBeVisible()

  const areas = [
    ["기업 분석", "company"],
    ["인물 & 팀 분석", "people"],
    ["이력서 피드백", "resume"],
    ["면접 준비", "interview"],
    ["기술 면접 준비", "technical"],
    ["토픽별 답안", "topics"],
    ["개요", "overview"]
  ] as const
  for (const [label, area] of areas) {
    await page
      .getByRole("navigation", { name: "채용공고 워크스페이스" })
      .getByRole("link", { name: label, exact: true })
      .click()
    await expect(page).toHaveURL(new RegExp(`/jobs/${postId}/${area}$`))
    await expect(page.getByRole("heading", { name: posting.title })).toBeVisible()
    await page.reload()
    await expect(page).toHaveURL(new RegExp(`/jobs/${postId}/${area}$`))
    await expect(page.getByRole("heading", { name: posting.title })).toBeVisible()
  }

  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto(`/jobs/${postId}/technical`)
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    )
    .toBe(true)
})
