import { expect, test } from "@playwright/test"

test("creates a posting and moves an application through the local pipeline", async ({ page }) => {
  test.setTimeout(20_000)
  const post = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Backend Engineer",
    companyName: "Acme",
    teamName: "Platform",
    state: "active",
    versionNumber: 1,
    sourceKind: "manual",
    canonicalUrl: "https://careers.example.com/backend",
    metadata: { location: "Seoul · Hybrid", employmentType: "Full-time" }
  }
  let stages = [
    {
      id: "00000000-0000-4000-8000-000000000001",
      key: "saved",
      name: "Saved",
      position: 1,
      outcome: null,
      system: true
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      key: "applied",
      name: "Applied",
      position: 2,
      outcome: null,
      system: true
    },
    {
      id: "00000000-0000-4000-8000-000000000003",
      key: "interviewing",
      name: "Interviewing",
      position: 3,
      outcome: null,
      system: true
    },
    {
      id: "00000000-0000-4000-8000-000000000004",
      key: "offered",
      name: "Offered",
      position: 4,
      outcome: "offered",
      system: true
    }
  ]
  const savedStage = stages[0]
  const appliedStage = stages[1]
  const interviewingStage = stages[2]
  const offeredStage = stages[3]
  if (
    savedStage === undefined ||
    appliedStage === undefined ||
    interviewingStage === undefined ||
    offeredStage === undefined
  )
    throw new Error("stages missing")
  let postings: (typeof post)[] = []
  let applications: Array<{
    id: string
    jobPostId: string
    stageId: string
    stageName: string
    appliedAt: string | null
    outcomeAt: string | null
    archivedAt: string | null
  }> = []
  const events: Array<{
    id: string
    sequence: number
    kind: string
    payload: Record<string, string>
    createdAt: string
  }> = [
    {
      id: "33333333-3333-4333-8333-333333333333",
      sequence: 1,
      kind: "created",
      payload: { stageId: savedStage.id },
      createdAt: "2026-08-28T00:00:00.000Z"
    }
  ]
  let versions = [
    {
      id: "44444444-4444-4444-8444-444444444444",
      postId: post.id,
      versionNumber: 1,
      sourceKind: "manual",
      createdAt: "2026-08-28T00:00:00.000Z"
    }
  ]
  await page.route("**/api/security/csrf", (route) =>
    route.fulfill({ json: { csrfToken: "token" } })
  )
  await page.route("**/api/postings", (route) => route.fulfill({ json: { postings } }))
  await page.route("**/api/pipeline/stages", async (route) => {
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON() as { key: string; name: string }
      stages = [
        ...stages,
        {
          id: "99999999-9999-4999-8999-999999999999",
          key: input.key,
          name: input.name,
          position: stages.length + 1,
          outcome: null,
          system: false
        }
      ]
    }
    await route.fulfill({
      status: route.request().method() === "POST" ? 201 : 200,
      json: { stages }
    })
  })
  await page.route("**/api/pipeline/stages/order", async (route) => {
    const { stageIds } = route.request().postDataJSON() as { stageIds: string[] }
    expect(route.request().method()).toBe("PUT")
    stages = stageIds.map((id, index) => {
      const stage = stages.find((candidate) => candidate.id === id)
      if (stage === undefined) throw new Error("stage missing")
      return { ...stage, position: index + 1 }
    })
    await route.fulfill({ status: 204 })
  })
  await page.route(/\/api\/pipeline\/stages\/[0-9a-f-]+$/, async (route) => {
    const id = route.request().url().split("/").at(-1)
    if (route.request().method() === "PATCH") {
      const { name } = route.request().postDataJSON() as { name: string }
      stages = stages.map((stage) => (stage.id === id ? { ...stage, name } : stage))
    } else if (route.request().method() === "DELETE") {
      stages = stages
        .filter((stage) => stage.id !== id)
        .map((stage, index) => ({ ...stage, position: index + 1 }))
    }
    await route.fulfill({ status: 204 })
  })
  await page.route("**/api/postings/manual", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      title: post.title,
      companyName: post.companyName,
      teamName: post.teamName,
      location: post.metadata.location,
      employmentType: post.metadata.employmentType,
      text: "Role body"
    })
    postings = [post]
    await route.fulfill({ status: 201, json: post })
  })
  await page.route(`**/api/postings/${post.id}/versions`, (route) =>
    route.fulfill({ json: { versions: [...versions].reverse() } })
  )
  await page.route(`**/api/postings/${post.id}/versions/url`, async (route) => {
    expect(route.request().headers()["x-csrf-token"]).toBe("token")
    expect(route.request().postDataJSON()).toEqual({ url: post.canonicalUrl })
    post.versionNumber = 2
    post.sourceKind = "url"
    versions = [
      ...versions,
      {
        id: "55555555-5555-4555-8555-555555555555",
        postId: post.id,
        versionNumber: 2,
        sourceKind: "url",
        createdAt: "2026-08-28T01:00:00.000Z"
      }
    ]
    await route.fulfill({ status: 201, json: post })
  })
  await page.route(`**/api/postings/${post.id}/versions/manual`, async (route) => {
    expect(route.request().postDataJSON()).toEqual({ text: "Updated role responsibilities" })
    post.versionNumber = 3
    post.sourceKind = "manual"
    versions = [
      ...versions,
      {
        id: "66666666-6666-4666-8666-666666666666",
        postId: post.id,
        versionNumber: 3,
        sourceKind: "manual",
        createdAt: "2026-08-28T02:00:00.000Z"
      }
    ]
    await route.fulfill({ status: 201, json: post })
  })
  await page.route(`**/api/postings/${post.id}/versions/file`, async (route) => {
    expect(route.request().headers()["content-type"]).toContain("multipart/form-data")
    expect(route.request().postDataBuffer()?.toString()).toContain("updated-role.txt")
    post.versionNumber = 4
    post.sourceKind = "file"
    versions = [
      ...versions,
      {
        id: "77777777-7777-4777-8777-777777777777",
        postId: post.id,
        versionNumber: 4,
        sourceKind: "file",
        createdAt: "2026-08-28T03:00:00.000Z"
      }
    ]
    await route.fulfill({ status: 201, json: post })
  })
  await page.route(`**/api/postings/${post.id}/archive`, async (route) => {
    expect(route.request().headers()["x-csrf-token"]).toBe("token")
    post.state = "archived"
    await route.fulfill({ status: 204 })
  })
  await page.route("**/api/applications", async (route) => {
    if (route.request().method() === "POST")
      applications = [
        {
          id: "22222222-2222-4222-8222-222222222222",
          jobPostId: post.id,
          stageId: savedStage.id,
          stageName: "Saved",
          appliedAt: null,
          outcomeAt: null,
          archivedAt: null
        }
      ]
    await route.fulfill({
      status: route.request().method() === "POST" ? 201 : 200,
      json: route.request().method() === "POST" ? applications[0] : { applications }
    })
  })
  let transitionRequests = 0
  await page.route("**/api/applications/*/transition", async (route) => {
    transitionRequests += 1
    const current = applications[0]
    if (current === undefined) throw new Error("application missing")
    const { stageId } = route.request().postDataJSON() as { stageId: string }
    const target = stages.find((stage) => stage.id === stageId)
    if (target === undefined) throw new Error("target stage missing")
    const changedAt =
      target.key === "applied"
        ? "2026-08-28T00:30:00.000Z"
        : target.outcome === null
          ? "2026-08-28T00:45:00.000Z"
          : "2026-09-02T05:00:00.000Z"
    applications[0] = {
      ...current,
      stageId: target.id,
      stageName: target.name,
      appliedAt: target.key === "applied" ? changedAt : current.appliedAt,
      outcomeAt: target.outcome === null ? current.outcomeAt : changedAt
    }
    events.push({
      id: crypto.randomUUID(),
      sequence: events.length + 1,
      kind: "stage_changed",
      payload: { fromStageId: current.stageId, toStageId: target.id },
      createdAt: changedAt
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    await route.fulfill({ json: applications[0] })
  })
  let archiveApplicationRequests = 0
  await page.route("**/api/applications/*/archive", async (route) => {
    archiveApplicationRequests += 1
    const current = applications[0]
    if (current === undefined) throw new Error("application missing")
    expect(route.request().headers()["x-csrf-token"]).toBe("token")
    applications[0] = { ...current, archivedAt: "2026-08-28T04:00:00.000Z" }
    await new Promise((resolve) => setTimeout(resolve, 100))
    await route.fulfill({ status: 204 })
  })
  await page.route("**/api/applications/*/history", (route) =>
    route.fulfill({
      json: {
        events,
        interviews
      }
    })
  )
  const interviews: Array<{
    id: string
    scheduledAt: string
    kind: string
    location: string | null
    notes: string
  }> = []
  let noteRequests = 0
  await page.route("**/api/applications/*/notes", async (route) => {
    noteRequests += 1
    expect(route.request().postDataJSON()).toEqual({ text: "Ask about the on-call rotation" })
    events.push({
      id: crypto.randomUUID(),
      sequence: events.length + 1,
      kind: "note_added",
      payload: { text: "Ask about the on-call rotation" },
      createdAt: "2026-08-28T01:00:00.000Z"
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    await route.fulfill({ status: 204 })
  })
  let interviewRequests = 0
  await page.route("**/api/applications/*/interviews", async (route) => {
    interviewRequests += 1
    const input = route.request().postDataJSON() as Omit<(typeof interviews)[number], "id">
    expect(input.kind).toBe("Technical interview")
    expect(input.location).toBe("https://meet.example.com/acme")
    expect(input.notes).toBe("Review distributed systems examples")
    interviews.push({ id: "88888888-8888-4888-8888-888888888888", ...input })
    await new Promise((resolve) => setTimeout(resolve, 100))
    await route.fulfill({ status: 201 })
  })

  await page.goto("/jobs")
  await expect(page.getByRole("button", { name: "공고 저장" })).toBeDisabled()
  await page.getByText("직무명").locator("..").getByRole("textbox").fill(post.title)
  await page
    .getByText("회사", { exact: true })
    .locator("..")
    .getByRole("textbox")
    .fill(post.companyName)
  await page.getByText("팀", { exact: true }).locator("..").getByRole("textbox").fill(post.teamName)
  await page
    .getByText("근무 위치", { exact: true })
    .locator("..")
    .getByRole("textbox")
    .fill(post.metadata.location)
  await page
    .getByText("고용 형태", { exact: true })
    .locator("..")
    .getByRole("textbox")
    .fill(post.metadata.employmentType)
  await page.getByPlaceholder("공고 내용").fill("Role body")
  await expect(page.getByRole("button", { name: "공고 저장" })).toBeEnabled()
  await page.getByRole("button", { name: "공고 저장" }).click()
  await expect(page.getByText(post.title)).toBeVisible()
  await expect(page.getByText("Seoul · Hybrid · Full-time")).toBeVisible()
  await page.getByRole("button", { name: "버전 기록" }).click()
  await expect(page.getByText("버전 1 · 직접 입력")).toBeVisible()
  await expect(page.getByLabel("갱신할 공개 공고 URL")).toHaveValue(post.canonicalUrl)
  await page.getByRole("button", { name: "새 버전 수집" }).click()
  await expect(page.getByText("버전 2 · URL")).toBeVisible()
  const versionCard = page.getByText(`${post.title} · 버전 기록`).locator("../..")
  await versionCard.getByRole("combobox").click()
  await page.getByRole("option", { name: "직접 입력" }).click()
  await versionCard.getByPlaceholder("공고 내용").fill("Updated role responsibilities")
  await versionCard.getByRole("button", { name: "새 버전 수집" }).click()
  await expect(page.getByText("버전 3 · 직접 입력")).toBeVisible()
  await versionCard.getByRole("combobox").click()
  await page.getByRole("option", { name: "파일" }).click()
  await versionCard.getByLabel("새 공고 버전 파일").setInputFiles({
    name: "updated-role.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Updated role from file")
  })
  await versionCard.getByRole("button", { name: "새 버전 수집" }).click()
  await expect(page.getByText("버전 4 · 파일")).toBeVisible()
  await page.getByRole("button", { name: "지원 시작" }).click()
  await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible()
  await expect(page.getByRole("button", { name: "지원 진행 중" })).toBeDisabled()
  await page.getByRole("combobox").last().click()
  await page.getByRole("option", { name: "Applied" }).click()
  const applicationStage = page.getByRole("combobox").last()
  const moveButton = page.getByRole("button", { name: "단계 이동" })
  const archiveApplicationButton = page.getByRole("button", { name: "지원 보관" })
  await moveButton.click()
  await expect(moveButton).toBeDisabled()
  await expect(applicationStage).toBeDisabled()
  await expect(archiveApplicationButton).toBeDisabled()
  await expect(page.getByText("Applied", { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/지원일 ·/)).toBeVisible()
  await page.getByRole("combobox").last().click()
  await page.getByRole("option", { name: "Interviewing" }).click()
  await page.getByRole("button", { name: "단계 이동" }).click()
  await expect(page.getByText("Interviewing", { exact: true }).first()).toBeVisible()
  await page.getByRole("button", { name: "전체 이력" }).click()
  await expect(page.getByText(/#1 지원 시작/)).toBeVisible()
  await expect(page.getByText("Saved", { exact: true }).last()).toBeVisible()
  await expect(page.getByText(/#2 단계 변경/)).toBeVisible()
  await expect(page.getByText("Saved → Applied")).toBeVisible()
  await expect(page.getByText("Applied → Interviewing")).toBeVisible()
  const noteInput = page.getByPlaceholder("메모", { exact: true })
  const noteButton = noteInput.locator("..").getByRole("button")
  await expect(noteButton).toBeDisabled()
  await noteInput.fill("  Ask about the on-call rotation  ")
  await expect(noteButton).toBeEnabled()
  await noteButton.click()
  await expect(noteButton).toBeDisabled()
  await expect(page.getByText(/#4 메모 추가/)).toBeVisible()
  await expect(page.getByText("Ask about the on-call rotation")).toBeVisible()
  expect(noteRequests).toBe(1)
  const interviewAt = page.locator('input[type="datetime-local"]')
  const interviewButton = interviewAt.locator("..").getByRole("button")
  await expect(interviewButton).toBeDisabled()
  await interviewAt.fill("2026-09-01T14:30")
  await page.getByPlaceholder("면접 종류").fill("Technical interview")
  await page.getByPlaceholder("면접 장소 또는 링크").fill("https://meet.example.com/acme")
  await page.getByPlaceholder("면접 준비 메모").fill("Review distributed systems examples")
  await expect(interviewButton).toBeEnabled()
  await interviewButton.click()
  await expect(interviewButton).toBeDisabled()
  await expect(page.getByText("Technical interview", { exact: false })).toBeVisible()
  await expect(page.getByText("면접 장소 또는 링크 · https://meet.example.com/acme")).toBeVisible()
  await expect(page.getByText("Review distributed systems examples")).toBeVisible()
  expect(interviewRequests).toBe(1)
  await page.getByRole("combobox").last().click()
  await page.getByRole("option", { name: "Offered" }).click()
  await page.getByRole("button", { name: "단계 이동" }).click()
  await expect(page.getByText("Offered", { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/결과 확정일 ·/)).toBeVisible()
  await expect(page.getByRole("button", { name: "단계 이동" })).toBeDisabled()
  await archiveApplicationButton.click()
  await expect(archiveApplicationButton).toBeDisabled()
  await expect(page.getByText("보관됨")).toBeVisible()
  await expect(page.getByRole("button", { name: "단계 이동" })).toBeDisabled()
  await expect(page.getByRole("button", { name: "지원 보관" })).toHaveCount(0)
  expect(transitionRequests).toBe(3)
  expect(archiveApplicationRequests).toBe(1)
  await page.getByPlaceholder("새 단계 이름").fill("Phone screen")
  await page.getByRole("button", { name: "단계 추가" }).click()
  const customStage = page.getByRole("button", { name: "단계 삭제: Phone screen" }).locator("..")
  await expect(customStage).toBeVisible()
  await customStage.getByRole("textbox").fill("Recruiter screen")
  await page.getByRole("button", { name: "단계 이름 저장: Phone screen" }).click()
  const renamedStage = page
    .getByRole("button", { name: "단계 삭제: Recruiter screen" })
    .locator("..")
  await expect(renamedStage.getByRole("textbox")).toHaveValue("Recruiter screen")
  await page.getByRole("button", { name: "단계 위로 이동: Recruiter screen" }).click()
  await expect(
    page.getByRole("button", { name: "단계 삭제: Recruiter screen" }).locator("..").locator("span")
  ).toHaveText("4")
  await page.getByRole("button", { name: "단계 삭제: Recruiter screen" }).click()
  await expect(page.getByRole("button", { name: "단계 삭제: Recruiter screen" })).toHaveCount(0)
  await page.getByRole("button", { name: "보관", exact: true }).click()
  await expect(page.getByText("보관됨").first()).toBeVisible()
  await expect(page.getByRole("button", { name: "지원 시작" })).toBeDisabled()
  await expect(page.getByRole("button", { name: "보관", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "버전 기록" }).click()
  await expect(page.getByRole("button", { name: "새 버전 수집" })).toBeDisabled()
})
