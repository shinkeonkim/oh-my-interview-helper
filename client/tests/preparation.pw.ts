import { expect, test } from "@playwright/test"

test("reviews disclosure and generates a new cited preparation revision", async ({ page }) => {
  test.setTimeout(20_000)
  const postId = "11111111-1111-4111-8111-111111111111"
  const postVersionId = "22222222-2222-4222-8222-222222222222"
  const documentVersionId = "33333333-3333-4333-8333-333333333333"
  const seriesId = "44444444-4444-4444-8444-444444444444"
  const secondPostId = "77777777-7777-4777-8777-777777777777"
  let revisionNumber = 0
  let provenanceRequests = 0
  let previewRequests = 0
  let runRequests = 0
  let taskRevision: Record<string, unknown> = {}
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
          },
          {
            id: secondPostId,
            title: "Frontend Engineer",
            companyName: "Beta",
            currentVersionId: "88888888-8888-4888-8888-888888888888",
            versionNumber: 1
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
    previewRequests += 1
    requestBodies.push(route.request().postDataJSON())
    await new Promise((resolve) => setTimeout(resolve, 100))
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
  const taskId = "99999999-9999-4999-8999-999999999999"
  await page.route("**/api/jobs", async (route) => {
    runRequests += 1
    requestBodies.push(
      (route.request().postDataJSON() as { input: { request: unknown } }).input.request
    )
    revisionNumber += 1
    taskRevision = {
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
    await route.fulfill({ status: 201, json: { id: taskId, state: "queued" } })
  })
  await page.route(`**/api/jobs/${taskId}`, (route) =>
    route.fulfill({ json: { id: taskId, state: "succeeded" } })
  )
  await page.route(`**/api/jobs/${taskId}/events?transport=poll`, (route) =>
    route.fulfill({
      json: { events: [{ kind: "progress", payload: { phase: "result", revision: taskRevision } }] }
    })
  )
  await page.route("**/api/workflows/run", async (route) => {
    runRequests += 1
    requestBodies.push(route.request().postDataJSON())
    revisionNumber += 1
    await new Promise((resolve) => setTimeout(resolve, 100))
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
  await page.route("**/api/artifacts/revisions/*/provenance", async (route) => {
    provenanceRequests += 1
    await route.fulfill({
      json: {
        id: crypto.randomUUID(),
        seriesId,
        number: revisionNumber,
        content: {},
        providerId: "anthropic-api",
        providerMode: "api",
        providerModel: "claude",
        promptTemplateId: "cover-letter",
        promptTemplateRevision: 1,
        inputs: [
          {
            label: "Backend Engineer",
            version: 3,
            hash: "a".repeat(64),
            ref: { kind: "job_post_version", jobPostVersionId: postVersionId }
          }
        ],
        staleReasons: provenanceRequests > 1 ? ["source_current_version_changed"] : []
      }
    })
  })

  await page.goto(`/jobs/${postId}/prepare`)
  await expect(page.getByRole("heading", { name: "맞춤형 면접 준비" })).toBeVisible()
  await page.getByLabel(/플랫폼 이력서/).check()
  await expect(page.getByText(/현재 채용공고는 항상 기본 자료로 포함/)).toBeVisible()
  await page.getByLabel("연습 답변 (선택)").fill("Reviewed answer")
  const reviewButton = page.getByRole("button", { name: "전송 내용 확인" })
  await reviewButton.click()
  await expect(reviewButton).toBeDisabled()

  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("anthropic-api · claude")
  await expect(dialog).toContainText("Backend Engineer · v3")
  await expect(dialog).toContainText("플랫폼 이력서 · v2")
  await page
    .locator("textarea")
    .first()
    .evaluate((node) => {
      const input = node as HTMLTextAreaElement
      input.value = "Changed after review"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
  await dialog.getByRole("button", { name: "확인하고 생성" }).click()
  await expect(dialog.getByRole("button", { name: "확인하고 생성" })).toBeDisabled()

  await expect(page.getByText("버전 1")).toBeVisible()
  await expect(page.getByText("플랫폼 경험")).toBeVisible()
  await expect(page.getByText("최신 상태")).toBeVisible()
  await expect(page.getByText("Backend Engineer · v3")).toBeVisible()
  await page.getByRole("button", { name: "근거 상태 새로고침" }).click()
  await expect(page.getByText("변경 감지")).toBeVisible()
  await expect(page.getByText("사용한 자료의 최신 버전이 변경되었습니다.")).toBeVisible()
  await page.getByRole("button", { name: "새 버전 생성" }).first().click()
  await dialog.getByRole("button", { name: "확인하고 생성" }).click()
  await expect(page.getByText("버전 2")).toBeVisible()
  expect(previewRequests).toBe(2)
  expect(runRequests).toBe(2)
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
  expect(requestBodies[1]).toEqual(expect.objectContaining({ practiceAnswer: "Reviewed answer" }))

  await page.evaluate((nextPath) => {
    window.history.pushState({}, "", nextPath)
    window.dispatchEvent(new PopStateEvent("popstate"))
  }, `/jobs/${secondPostId}/prepare`)
  await expect(page.getByText("Frontend Engineer", { exact: true })).toBeVisible()
  await expect(page.getByText("플랫폼 경험")).toHaveCount(0)
  await expect(page.getByText("생성 근거")).toHaveCount(0)

  await page.getByRole("button", { name: "전송 내용 확인" }).click()
  await page.evaluate((nextPath) => {
    window.history.pushState({}, "", nextPath)
    window.dispatchEvent(new PopStateEvent("popstate"))
  }, `/jobs/${postId}/prepare`)
  await expect(page.getByText("Backend Engineer", { exact: true })).toBeVisible()
  await page.waitForTimeout(150)
  await expect(page.getByRole("dialog")).toHaveCount(0)
})
