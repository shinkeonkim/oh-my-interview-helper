import { expect, test } from "@playwright/test"

test("reviews exact sources and keeps a cited application conversation", async ({ page }) => {
  const postId = "11111111-1111-4111-8111-111111111111"
  const postVersionId = "22222222-2222-4222-8222-222222222222"
  const applicationId = "33333333-3333-4333-8333-333333333333"
  const documentVersionId = "44444444-4444-4444-8444-444444444444"
  const conversationId = "55555555-5555-4555-8555-555555555555"
  const bodies: unknown[] = []
  const fulfill = (route: Parameters<Parameters<typeof page.route>[1]>[0], json: unknown) =>
    route.fulfill({ json })

  await page.route("**/api/security/csrf", (route) => fulfill(route, { csrfToken: "token" }))
  await page.route("**/api/postings", (route) =>
    fulfill(route, {
      postings: [
        {
          id: postId,
          title: "Backend Engineer",
          companyName: "Acme",
          teamName: "Platform",
          currentVersionId: postVersionId,
          versionNumber: 4
        }
      ]
    })
  )
  await page.route("**/api/applications", (route) =>
    fulfill(route, {
      applications: [
        { id: applicationId, jobPostId: postId, stageName: "Interviewing", appliedAt: null }
      ]
    })
  )
  await page.route(`**/api/applications/${applicationId}/history`, (route) =>
    fulfill(route, { events: [], interviews: [] })
  )
  await page.route("**/api/documents", (route) =>
    fulfill(route, {
      documents: [
        {
          id: crypto.randomUUID(),
          title: "플랫폼 이력서",
          state: "active",
          currentVersionId: documentVersionId,
          versionNumber: 2
        }
      ]
    })
  )
  await page.route("**/api/providers/status", (route) =>
    fulfill(route, {
      providers: [
        {
          id: "anthropic-api",
          model: { id: "claude", displayName: "Claude" },
          configured: true
        }
      ]
    })
  )
  await page.route(/\/api\/conversations\?applicationId=/, (route) =>
    fulfill(route, { conversations: [] })
  )
  await page.route("**/api/conversations/preview", async (route) => {
    bodies.push(route.request().postDataJSON())
    await fulfill(route, {
      authorizationToken: "signed-token",
      manifest: {
        destination: "anthropic-api",
        model: "claude",
        action: "application-chat",
        inputs: [
          { label: "Backend Engineer", version: 4, hash: "a".repeat(64) },
          { label: "플랫폼 이력서", version: 2, hash: "b".repeat(64) }
        ]
      }
    })
  })
  await page.route("**/api/disclosures/confirm", (route) =>
    fulfill(route, { id: "66666666-6666-4666-8666-666666666666" })
  )
  const taskId = "77777777-7777-4777-8777-777777777777"
  const taskResult = {
    conversation: { id: conversationId, title: "Backend Engineer" },
    messages: [
      { id: crypto.randomUUID(), role: "user", content: { text: "강조할 경험은?" } },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: {
          answer: "대규모 플랫폼 운영 경험을 강조하세요.",
          citations: [{ sourceId: postVersionId, note: "공고의 운영 역량 요구" }]
        }
      }
    ]
  }
  await page.route("**/api/jobs", async (route) => {
    bodies.push((route.request().postDataJSON() as { input: { request: unknown } }).input.request)
    await route.fulfill({ status: 201, json: { id: taskId, state: "queued" } })
  })
  await page.route(`**/api/jobs/${taskId}`, (route) =>
    fulfill(route, { id: taskId, state: "succeeded" })
  )
  await page.route(`**/api/jobs/${taskId}/events?transport=poll`, (route) =>
    fulfill(route, { events: [{ kind: "progress", payload: { phase: "result", ...taskResult } }] })
  )
  await page.route("**/api/conversations/send", async (route) => {
    bodies.push(route.request().postDataJSON())
    await fulfill(route, {
      conversation: { id: conversationId, title: "Backend Engineer" },
      messages: [
        { id: crypto.randomUUID(), role: "user", content: { text: "강조할 경험은?" } },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: {
            answer: "대규모 플랫폼 운영 경험을 강조하세요.",
            citations: [{ sourceId: postVersionId, note: "공고의 운영 역량 요구" }]
          }
        }
      ]
    })
  })

  await page.goto(`/jobs/${postId}/overview`)
  await expect(page.getByText("지원별 AI 대화", { exact: true })).toBeVisible()
  await page.getByLabel("참고 문서").selectOption(documentVersionId)
  await page.getByLabel("질문").fill("강조할 경험은?")
  await page.getByRole("button", { name: "전송 내용 확인" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("Backend Engineer · v4")
  await expect(dialog).toContainText("플랫폼 이력서 · v2")
  await dialog.getByRole("button", { name: "확인하고 전송" }).click()
  await expect(page.getByText("대규모 플랫폼 운영 경험을 강조하세요.")).toBeVisible()
  await expect(page.getByText(/근거 · 공고의 운영 역량 요구/)).toBeVisible()
  expect(bodies).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        applicationId,
        conversationId: null,
        inputs: [
          { kind: "job_post_version", jobPostVersionId: postVersionId },
          { kind: "document_version", documentVersionId }
        ]
      }),
      expect.objectContaining({
        applicationId,
        disclosureId: "66666666-6666-4666-8666-666666666666"
      })
    ])
  )
})
