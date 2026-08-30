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
  let previewRequests = 0
  let saveRequests = 0
  const oldUrl = "https://careers.example.com/old"
  await page.route("**/api/security/csrf", (route) =>
    route.fulfill({ json: { csrfToken: "job-search-token" } })
  )
  await page.route("**/api/postings", (route) => route.fulfill({ json: { postings } }))
  await page.route("**/api/preview/url", async (route) => {
    previewRequests += 1
    expect(route.request().headers()["x-csrf-token"]).toBe("job-search-token")
    const input = route.request().postDataJSON() as { url: string }
    const old = input.url === oldUrl
    await new Promise((resolve) => setTimeout(resolve, old ? 200 : 20))
    await route.fulfill({
      json: {
        url: input.url,
        contentType: "text/html",
        text: old
          ? "Outdated role preview"
          : "Build reliable platform services with our infrastructure team."
      }
    })
  })
  await page.route("**/api/postings/url", async (route) => {
    saveRequests += 1
    expect(route.request().headers()["x-csrf-token"]).toBe("job-search-token")
    savedBody = route.request().postDataJSON()
    postings = [posting]
    await new Promise((resolve) => setTimeout(resolve, 100))
    await route.fulfill({ status: 201, json: posting })
  })

  await page.goto("/job-search")
  await expect(page.getByRole("heading", { name: "채용 탐색" })).toBeVisible()
  const urlInput = page.getByLabel("채용공고 URL")
  const inspectButton = page.getByRole("button", { name: "내용 확인" })
  await urlInput.fill("ftp://careers.example.com/platform")
  await expect(inspectButton).toBeDisabled()
  await urlInput.fill(oldUrl)
  await inspectButton.click()
  await urlInput.fill(posting.canonicalUrl)
  await inspectButton.click()
  await expect(page.getByText(/Build reliable platform services/)).toBeVisible()
  await page.waitForTimeout(220)
  await expect(page.getByText("Outdated role preview")).toHaveCount(0)
  expect(previewRequests).toBe(2)
  await page.getByLabel("직무명").fill(posting.title)
  await page.getByLabel("회사", { exact: true }).fill(posting.companyName)
  await page.getByLabel("팀", { exact: true }).fill(posting.teamName)
  const saveButton = page.getByRole("button", { name: "공고로 저장" })
  await saveButton.click()
  await expect(saveButton).toBeDisabled()
  await expect(urlInput).toBeDisabled()
  await expect(inspectButton).toBeDisabled()

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
  expect(saveRequests).toBe(1)
})
