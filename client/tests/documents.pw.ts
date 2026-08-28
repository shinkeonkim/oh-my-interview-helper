import { expect, test } from "@playwright/test"

test("uploads, selects, previews, and exposes document source usage", async ({ page }) => {
  let documents: unknown[] = []
  await page.route("**/api/security/csrf", (route) =>
    route.fulfill({ json: { csrfToken: "test-token" } })
  )
  await page.route("**/api/documents", (route) => route.fulfill({ json: { documents } }))
  await page.route("**/api/documents/upload", async (route) => {
    documents = [
      {
        id: "1b5baec5-03d7-4707-aa71-60b40f068ae8",
        kind: "resume",
        title: "resume",
        state: "active",
        selected: false,
        currentVersionId: "149ed1ba-ad1b-449f-8e8e-40c086353ac4",
        versionNumber: 1,
        displayName: "resume.txt",
        byteSize: 18,
        extractionStatus: "completed",
        usageCount: 2
      }
    ]
    await route.fulfill({ status: 201, json: { documents } })
  })
  await page.route("**/api/documents/*/selection", async (route) => {
    documents = documents.map((document) => ({ ...(document as object), selected: true }))
    await route.fulfill({ status: 204 })
  })
  await page.route("**/api/documents/*/preview", (route) =>
    route.fulfill({ json: { title: "resume", text: "Selected profile evidence" } })
  )
  await page.route("**/api/documents/*/archive", async (route) => {
    documents = documents.map((document) => ({
      ...(document as object),
      state: "archived",
      selected: false
    }))
    await route.fulfill({ status: 204 })
  })
  await page.route("**/api/documents/*/delete", async (route) => {
    documents = []
    await route.fulfill({ status: 204 })
  })

  await page.goto("/documents")
  await expect(page.getByText("아직 저장된 문서가 없습니다.")).toBeVisible()
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "resume.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("profile evidence")
    })
  await expect(page.getByText("resume", { exact: true })).toBeVisible()
  await expect(page.getByText("출처 사용: 2")).toBeVisible()
  await page.getByRole("button", { name: "프로필에 사용" }).click()
  await expect(page.getByText("프로필에 선택됨")).toBeVisible()
  await page.getByRole("button", { name: "미리보기" }).click()
  await expect(page.getByText("Selected profile evidence")).toBeVisible()
  await page.getByRole("button", { name: "보관" }).click()
  await expect(page.getByText("보관됨")).toBeVisible()
  await expect(page.getByRole("button", { name: "프로필에 사용" })).toBeDisabled()
  await expect(page.getByText("새 버전")).toBeDisabled()
  await expect(page.getByRole("button", { name: "보관" })).toHaveCount(0)
  await page.getByRole("button", { name: "삭제" }).click()
  await expect(page.getByText("아직 저장된 문서가 없습니다.")).toBeVisible()
})
