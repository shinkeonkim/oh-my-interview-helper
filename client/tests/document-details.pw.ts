import { expect, test } from "@playwright/test"

test("keeps the latest document preview and version history selection", async ({ page }) => {
  const documents = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      kind: "resume",
      title: "First resume",
      state: "active",
      selected: false,
      currentVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      versionNumber: 1,
      displayName: "first.txt",
      byteSize: 100,
      extractionStatus: "completed",
      usageCount: 0
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      kind: "portfolio",
      title: "Second portfolio",
      state: "active",
      selected: false,
      currentVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      versionNumber: 2,
      displayName: "second.txt",
      byteSize: 200,
      extractionStatus: "completed",
      usageCount: 0
    }
  ]
  const firstDocument = documents[0]
  if (firstDocument === undefined) throw new Error("fixture missing")

  await page.route("**/api/documents", (route) => route.fulfill({ json: { documents } }))
  await page.route(/\/api\/documents\/[^/]+\/preview$/, async (route) => {
    const first = route.request().url().includes(firstDocument.id)
    await new Promise((resolve) => setTimeout(resolve, first ? 200 : 20))
    await route.fulfill({
      json: {
        title: first ? "First resume" : "Second portfolio",
        text: first ? "First preview" : "Second preview"
      }
    })
  })
  await page.route(/\/api\/documents\/[^/]+\/versions$/, async (route) => {
    const first = route.request().url().includes(firstDocument.id)
    await new Promise((resolve) => setTimeout(resolve, first ? 200 : 20))
    await route.fulfill({
      json: {
        versions: [
          {
            id: first
              ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
              : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            versionNumber: first ? 1 : 2,
            displayName: first ? "first.txt" : "second.txt",
            createdAt: "2026-08-29T00:00:00.000Z"
          }
        ]
      }
    })
  })

  await page.goto("/documents")

  const previewButtons = page.getByRole("button", { name: "미리보기" })
  await previewButtons.nth(0).click()
  await previewButtons.nth(1).click()
  await expect(page.getByText("Second preview")).toBeVisible()
  await page.waitForTimeout(250)
  await expect(page.getByText("Second preview")).toBeVisible()
  await expect(page.getByText("First preview")).toHaveCount(0)

  const historyButtons = page.getByRole("button", { name: "버전 기록" })
  await historyButtons.nth(0).click()
  await historyButtons.nth(1).click()
  await expect(page.getByText("Second portfolio · 버전 기록")).toBeVisible()
  await page.waitForTimeout(250)
  await expect(page.getByText("Second portfolio · 버전 기록")).toBeVisible()
  await expect(page.getByText("First resume · 버전 기록")).toHaveCount(0)
})

test("keeps the latest document list after overlapping changes", async ({ page }) => {
  let documents = [
    {
      id: "33333333-3333-4333-8333-333333333333",
      kind: "resume",
      title: "Resume A",
      state: "active",
      selected: false,
      currentVersionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      versionNumber: 1,
      displayName: "resume-a.txt",
      byteSize: 100,
      extractionStatus: "completed",
      usageCount: 0
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      kind: "portfolio",
      title: "Portfolio B",
      state: "active",
      selected: false,
      currentVersionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      versionNumber: 1,
      displayName: "portfolio-b.txt",
      byteSize: 100,
      extractionStatus: "completed",
      usageCount: 0
    }
  ]
  let listRequests = 0

  await page.route("**/api/security/csrf", (route) =>
    route.fulfill({ json: { csrfToken: "token" } })
  )
  await page.route("**/api/documents", async (route) => {
    listRequests += 1
    const snapshot = structuredClone(documents)
    if (listRequests === 2) await new Promise((resolve) => setTimeout(resolve, 400))
    if (listRequests === 3) await new Promise((resolve) => setTimeout(resolve, 20))
    await route.fulfill({ json: { documents: snapshot } })
  })
  await page.route("**/api/documents/*/selection", async (route) => {
    const id = route.request().url().split("/").at(-2)
    const first = id === documents[0]?.id
    await new Promise((resolve) => setTimeout(resolve, first ? 300 : 500))
    documents = documents.map((document) =>
      document.id === id ? { ...document, selected: true } : document
    )
    await route.fulfill({ status: 204 })
  })

  await page.goto("/documents")
  const selectButtons = page.getByRole("button", { name: "프로필에 사용" })
  await selectButtons.nth(0).click()
  await selectButtons.nth(1).click()

  await expect.poll(() => listRequests).toBe(3)
  await page.waitForTimeout(450)
  await expect(page.getByRole("button", { name: "선택 해제" })).toHaveCount(2)
})
