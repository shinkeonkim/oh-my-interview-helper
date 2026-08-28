import { expect, test } from "@playwright/test"

test("summarizes local preparation and continues the latest application workspace", async ({
  page
}) => {
  const olderPostId = "11111111-1111-4111-8111-111111111111"
  const latestPostId = "22222222-2222-4222-8222-222222222222"
  await page.route("**/api/postings", (route) =>
    route.fulfill({
      json: {
        postings: [
          { id: olderPostId, title: "Frontend Engineer", companyName: "Old Co" },
          { id: latestPostId, title: "Backend Engineer", companyName: "Acme" }
        ]
      }
    })
  )
  await page.route("**/api/applications", (route) =>
    route.fulfill({
      json: {
        applications: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            jobPostId: olderPostId,
            stageName: "Applied",
            appliedAt: "2026-08-20T00:00:00.000Z"
          },
          {
            id: "44444444-4444-4444-8444-444444444444",
            jobPostId: latestPostId,
            stageName: "Interviewing",
            appliedAt: "2026-08-28T00:00:00.000Z"
          }
        ]
      }
    })
  )
  await page.route("**/api/documents", (route) =>
    route.fulfill({
      json: {
        documents: [
          { id: "active", title: "이력서", state: "active" },
          { id: "archived", title: "예전 이력서", state: "archived" }
        ]
      }
    })
  )

  await page.goto("/")
  const summary = page.getByRole("region", { name: "로컬 준비 현황" })
  await expect(summary.getByText("채용공고").locator("../..")).toContainText("2")
  await expect(summary.getByText("지원서").locator("../..")).toContainText("2")
  await expect(summary.getByText("활성 문서").locator("../..")).toContainText("1")
  await expect(page.getByText("Backend Engineer", { exact: true })).toBeVisible()
  await expect(page.getByText("Acme", { exact: true })).toBeVisible()
  await expect(page.getByText("Interviewing", { exact: true })).toBeVisible()
  await page.getByRole("link", { name: "워크스페이스 계속하기" }).click()
  await expect(page).toHaveURL(`/jobs/${latestPostId}/overview`)
})
