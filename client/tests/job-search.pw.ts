import { expect, test } from "@playwright/test"

test("discovers matching public jobs from criteria and saves a recommendation", async ({
  page
}) => {
  const documentVersionId = "22222222-2222-4222-8222-222222222222"
  const recommendation = {
    title: "Platform Engineer",
    company: "Acme",
    url: "https://careers.example.com/platform",
    platform: "원티드",
    location: "서울",
    experience: "5년 이상",
    companySize: "성장 단계",
    summary: "신뢰도 높은 플랫폼 서비스를 구축합니다.",
    score: 91,
    breakdown: { profile: 94, criteria: 90, freshness: 88 },
    matchedSkills: ["TypeScript", "Kubernetes"],
    gaps: ["대규모 트래픽 경험 확인 필요"],
    rationale: "대표 프로필의 플랫폼 운영 경험과 잘 맞습니다."
  }
  let discoveryBody: unknown = null
  let savedBody: unknown = null
  await page.route("**/api/security/csrf", (route) =>
    route.fulfill({ json: { csrfToken: "job-search-token" } })
  )
  await page.route("**/api/documents", (route) =>
    route.fulfill({
      json: {
        documents: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            title: "대표 이력서",
            kind: "resume",
            state: "active",
            selected: true,
            currentVersionId: documentVersionId
          }
        ]
      }
    })
  )
  await page.route("**/api/postings", (route) => route.fulfill({ json: { postings: [] } }))
  const taskId = "33333333-3333-4333-8333-333333333333"
  await page.route("**/api/jobs", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: [] })
    discoveryBody = route.request().postDataJSON()
    expect(route.request().headers()["x-csrf-token"]).toBe("job-search-token")
    await route.fulfill({ status: 201, json: { id: taskId, state: "queued" } })
  })
  await page.route(`**/api/jobs/${taskId}`, (route) =>
    route.fulfill({ json: { id: taskId, state: "succeeded" } })
  )
  await page.route(`**/api/jobs/${taskId}/events?transport=poll`, (route) =>
    route.fulfill({
      json: {
        events: [
          { kind: "progress", payload: { phase: "result", recommendations: [recommendation] } }
        ]
      }
    })
  )
  await page.route("**/api/postings/url", async (route) => {
    savedBody = route.request().postDataJSON()
    await route.fulfill({ status: 201, json: { id: "post-1" } })
  })

  await page.goto("/job-search")
  await page.getByLabel("직무", { exact: true }).fill("플랫폼 엔지니어")
  await page.getByLabel("기술 스택").fill("TypeScript, Kubernetes")
  await page.getByRole("button", { name: "에이전트로 채용공고 탐색" }).click()

  await expect(page.getByText("Platform Engineer")).toBeVisible()
  await expect(page.getByText("91")).toBeVisible()
  await expect(page.getByText("TypeScript")).toBeVisible()
  expect(discoveryBody).toMatchObject({
    kind: "ui.job_discovery",
    input: {
      request: {
        roles: ["플랫폼 엔지니어"],
        skills: ["TypeScript", "Kubernetes"],
        documentVersionIds: [documentVersionId]
      }
    }
  })

  await page.getByRole("button", { name: "공고로 저장" }).click()
  await expect.poll(() => savedBody).not.toBeNull()
  expect(savedBody).toEqual({
    url: recommendation.url,
    title: recommendation.title,
    companyName: recommendation.company,
    teamName: null,
    location: recommendation.location,
    employmentType: null
  })
})

test("restores completed discovery after returning to the screen", async ({ page }) => {
  const taskId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  const recommendation = {
    title: "Recovered role",
    company: "Acme",
    url: "https://careers.example.com/recovered",
    platform: "wanted",
    location: null,
    experience: null,
    companySize: null,
    summary: "화면을 벗어난 동안 완료된 결과",
    score: 88,
    breakdown: { profile: 90, criteria: 88, freshness: 84 },
    matchedSkills: [],
    gaps: [],
    rationale: "대표 프로필과 일치"
  }
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    ["background-task:job-discovery", taskId]
  )
  await page.route("**/api/documents", (route) => route.fulfill({ json: { documents: [] } }))
  await page.route("**/api/postings", (route) => route.fulfill({ json: { postings: [] } }))
  await page.route("**/api/jobs", (route) => route.fulfill({ json: [] }))
  await page.route(`**/api/jobs/${taskId}`, (route) =>
    route.fulfill({ json: { id: taskId, state: "succeeded" } })
  )
  await page.route(`**/api/jobs/${taskId}/events?transport=poll`, (route) =>
    route.fulfill({
      json: {
        events: [
          { kind: "progress", payload: { phase: "result", recommendations: [recommendation] } }
        ]
      }
    })
  )

  await page.goto("/job-search")
  await expect(page.getByText("Recovered role")).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("background-task:job-discovery")))
    .toBeNull()
})
