import { expect, test } from "@playwright/test"

test("searches postings, active documents, and scoped research with direct navigation", async ({
  page
}) => {
  const postId = "11111111-1111-4111-8111-111111111111"
  const researchRequests: string[] = []
  await page.route("**/api/postings", (route) =>
    route.fulfill({
      json: {
        postings: [
          {
            id: postId,
            title: "Backend Engineer",
            companyName: "Acme",
            teamName: "Platform"
          }
        ]
      }
    })
  )
  await page.route("**/api/documents", (route) =>
    route.fulfill({
      json: {
        documents: [
          { id: "active", title: "플랫폼 이력서", kind: "resume", state: "active" },
          { id: "archived", title: "예전 플랫폼 이력서", kind: "resume", state: "archived" }
        ]
      }
    })
  )
  await page.route("**/api/research**", (route) => {
    const url = route.request().url()
    researchRequests.push(url)
    return route.fulfill({
      json: {
        records: url.includes("jobPostId=")
          ? [
              {
                id: "22222222-2222-4222-8222-222222222222",
                subjectName: "Acme Platform Lead",
                subjectType: "team_lead",
                createdAt: "2026-08-28T00:00:00.000Z"
              }
            ]
          : []
      }
    })
  })

  await page.goto("/search")
  const input = page.getByRole("searchbox", { name: "검색어" })
  await input.fill("acme")
  await expect(page.getByText("Backend Engineer")).toBeVisible()
  await expect(page.getByText("Acme Platform Lead")).toBeVisible()
  await expect(page.getByText("채용공고", { exact: true })).toBeVisible()
  await expect(page.getByText("리서치", { exact: true })).toBeVisible()
  expect(researchRequests.some((url) => url.includes(`jobPostId=${postId}`))).toBe(true)

  await input.fill("플랫폼 이력서")
  await expect(page.getByText("플랫폼 이력서", { exact: true })).toBeVisible()
  await expect(page.getByText("예전 플랫폼 이력서")).toHaveCount(0)

  await input.fill("backend")
  await page.getByText("Backend Engineer").click()
  await expect(page).toHaveURL(`/jobs/${postId}/overview`)
})
