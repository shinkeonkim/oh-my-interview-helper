import { expect, test } from "@playwright/test"

test("inspects a public job URL before saving it to the local workspace", async ({ page }) => {
  const posting = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Platform Engineer",
    companyName: "Acme",
    teamName: "Infrastructure",
    canonicalUrl: "https://careers.example.com/platform",
    sourceKind: "url"
  }
  let postings: (typeof posting)[] = []
  let savedBody: unknown = null
  await page.route("**/api/security/csrf", (route) =>
    route.fulfill({ json: { csrfToken: "job-search-token" } })
  )
  await page.route("**/api/postings", (route) => route.fulfill({ json: { postings } }))
  await page.route("**/api/preview/url", async (route) => {
    expect(route.request().headers()["x-csrf-token"]).toBe("job-search-token")
    expect(route.request().postDataJSON()).toEqual({ url: posting.canonicalUrl })
    await route.fulfill({
      json: {
        url: posting.canonicalUrl,
        contentType: "text/html",
        text: "Build reliable platform services with our infrastructure team."
      }
    })
  })
  await page.route("**/api/postings/url", async (route) => {
    expect(route.request().headers()["x-csrf-token"]).toBe("job-search-token")
    savedBody = route.request().postDataJSON()
    postings = [posting]
    await route.fulfill({ status: 201, json: posting })
  })

  await page.goto("/job-search")
  await expect(page.getByRole("heading", { name: "채용 탐색" })).toBeVisible()
  await page.getByLabel("채용공고 URL").fill(posting.canonicalUrl)
  await page.getByRole("button", { name: "내용 확인" }).click()
  await expect(page.getByText(/Build reliable platform services/)).toBeVisible()
  await page.getByText("직무명").locator("..").getByRole("textbox").fill(posting.title)
  await page
    .getByText("회사", { exact: true })
    .locator("..")
    .getByRole("textbox")
    .fill(posting.companyName)
  await page
    .getByText("팀", { exact: true })
    .locator("..")
    .getByRole("textbox")
    .fill(posting.teamName)
  await page.getByRole("button", { name: "공고로 저장" }).click()

  await expect(page.getByRole("link", { name: /Platform Engineer/ })).toHaveAttribute(
    "href",
    `/jobs/${posting.id}/overview`
  )
  expect(savedBody).toEqual({
    url: posting.canonicalUrl,
    title: posting.title,
    companyName: posting.companyName,
    teamName: posting.teamName,
    location: null,
    employmentType: null
  })
})
