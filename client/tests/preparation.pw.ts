import { expect, test } from "@playwright/test"

test("reviews disclosure and generates a new cited preparation revision", async ({ page }) => {
  const postId = "11111111-1111-4111-8111-111111111111"
  const postVersionId = "22222222-2222-4222-8222-222222222222"
  const documentVersionId = "33333333-3333-4333-8333-333333333333"
  const seriesId = "44444444-4444-4444-8444-444444444444"
  let revisionNumber = 0
  const requestBodies: unknown[] = []

  await page.route("**/api/security/csrf", (route) =>
    route.fulfill({ json: { csrfToken: "token" } })
  )
  await page.route("**/api/postings", (route) =>
    route.fulfill({
      json: {
        postings: [
          {
            id: postId,
            title: "Backend Engineer",
            companyName: "Acme",
            currentVersionId: postVersionId,
            versionNumber: 3
          }
        ]
      }
    })
  )
  await page.route("**/api/documents", (route) =>
    route.fulfill({
      json: {
        documents: [
          {
            id: crypto.randomUUID(),
            title: "플랫폼 이력서",
            state: "active",
            currentVersionId: documentVersionId,
            versionNumber: 2
          }
        ]
      }
    })
  )
  await page.route("**/api/providers/status", (route) =>
    route.fulfill({
      json: {
        providers: [
          {
            id: "anthropic-api",
            model: { id: "claude", displayName: "Claude" },
            configured: true
          }
        ]
      }
    })
  )
  await page.route("**/api/workflows/preview", async (route) => {
    requestBodies.push(route.request().postDataJSON())
    await route.fulfill({
      json: {
        authorizationToken: "signed-token",
        manifest: {
          destination: "anthropic-api",
          model: "claude",
          action: "prepare:cover_letter",
          inputs: [
            {
              type: "job_post_version",
              label: "Backend Engineer",
              version: 3,
              hash: "a".repeat(64)
            },
            { type: "document_version", label: "플랫폼 이력서", version: 2, hash: "b".repeat(64) }
          ]
        }
      }
    })
  })
  await page.route("**/api/disclosures/confirm", (route) =>
    route.fulfill({ status: 201, json: { id: "55555555-5555-4555-8555-555555555555" } })
  )
  await page.route("**/api/workflows/run", async (route) => {
    requestBodies.push(route.request().postDataJSON())
    revisionNumber += 1
    await route.fulfill({
      status: 201,
      json: {
        id: crypto.randomUUID(),
        seriesId,
        number: revisionNumber,
        providerId: "anthropic-api",
        providerModel: "claude",
        content: {
          workflow: "cover_letter",
          title: "지원 동기",
          summary: "근거 기반 초안",
          sections: [
            {
              heading: "경험",
              body: "플랫폼 경험",
              citations: [{ sourceId: postVersionId, note: "공고" }]
            }
          ]
        }
      }
    })
  })

  await page.goto(`/jobs/${postId}/prepare`)
  await expect(page.getByRole("heading", { name: "맞춤형 면접 준비" })).toBeVisible()
  await page.getByText("참고 문서").locator("..").getByRole("combobox").click()
  await page.getByRole("option", { name: /플랫폼 이력서/ }).click()
  await page.getByRole("button", { name: "전송 내용 확인" }).click()

  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("anthropic-api · claude")
  await expect(dialog).toContainText("Backend Engineer · v3")
  await expect(dialog).toContainText("플랫폼 이력서 · v2")
  await dialog.getByRole("button", { name: "확인하고 생성" }).click()

  await expect(page.getByText("버전 1")).toBeVisible()
  await expect(page.getByText("플랫폼 경험")).toBeVisible()
  await page.getByRole("button", { name: "새 버전 생성" }).first().click()
  await dialog.getByRole("button", { name: "확인하고 생성" }).click()
  await expect(page.getByText("버전 2")).toBeVisible()
  expect(requestBodies).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        providerId: "anthropic-api",
        inputs: expect.arrayContaining([
          { kind: "job_post_version", jobPostVersionId: postVersionId },
          { kind: "document_version", documentVersionId }
        ])
      }),
      expect.objectContaining({ seriesId })
    ])
  )
})
