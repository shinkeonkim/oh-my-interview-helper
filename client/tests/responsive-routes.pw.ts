import { expect, test, type Page } from "@playwright/test"

const postId = "11111111-1111-4111-8111-111111111111"
const applicationId = "22222222-2222-4222-8222-222222222222"
const versionId = "33333333-3333-4333-8333-333333333333"

const routes = [
  "/",
  "/search",
  "/jobs",
  "/documents",
  "/job-search",
  "/research",
  "/stats",
  "/settings",
  ...["overview", "company", "people", "resume", "interview", "culture", "technical", "topics"].map(
    (area) => `/jobs/${postId}/${area}`
  ),
  `/jobs/${postId}/prepare`,
  "/not-found"
]

const mockApi = async (page: Page) => {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === "/api/postings")
      return route.fulfill({
        json: {
          postings: [
            {
              id: postId,
              title: "Responsive Platform Engineer",
              companyName: "Acme",
              teamName: "Platform",
              currentVersionId: versionId,
              versionNumber: 1,
              canonicalUrl: null,
              detectedStack: ["TypeScript", "PostgreSQL"]
            }
          ]
        }
      })
    if (url.pathname === "/api/applications")
      return route.fulfill({
        json: {
          applications: [
            {
              id: applicationId,
              jobPostId: postId,
              stageName: "Applied",
              appliedAt: null
            }
          ]
        }
      })
    if (url.pathname === `/api/applications/${applicationId}/history`)
      return route.fulfill({ json: { events: [], interviews: [] } })
    if (url.pathname === "/api/documents")
      return route.fulfill({
        json: {
          documents: [
            {
              id: "44444444-4444-4444-8444-444444444444",
              title: "대표 이력서",
              kind: "resume",
              state: "active",
              selected: true,
              currentVersionId: "55555555-5555-4555-8555-555555555555",
              versionNumber: 1,
              displayName: "resume.pdf",
              byteSize: 1024,
              extractionStatus: "completed",
              usageCount: 0
            }
          ]
        }
      })
    if (url.pathname === "/api/providers/status") return route.fulfill({ json: { providers: [] } })
    if (url.pathname === "/api/research") return route.fulfill({ json: { records: [] } })
    if (url.pathname === "/api/jobs") return route.fulfill({ json: [] })
    if (url.pathname === "/api/stats/overview")
      return route.fulfill({
        json: {
          uptime: { since: "2026-09-01T00:00:00.000Z", milliseconds: 60_000 },
          memory: { rssMb: 100, heapUsedMb: 40, heapTotalMb: 80, externalMb: 5 },
          counts: {},
          providerRuns: {
            total: 0,
            tokens: { input: 0, output: 0, cache: 0 },
            byKind: [],
            states: []
          }
        }
      })
    if (url.pathname === "/api/security/csrf")
      return route.fulfill({ json: { csrfToken: "responsive-test" } })
    if (url.pathname.startsWith("/api/conversations"))
      return route.fulfill({ json: { conversations: [], messages: [] } })
    return route.fulfill({ json: { stages: [], records: [], results: [] } })
  })
}

test("모든 화면이 모바일·태블릿·데스크톱 너비를 벗어나지 않는다", async ({ page }) => {
  test.setTimeout(90_000)
  await mockApi(page)

  for (const width of [320, 375, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    for (const path of routes) {
      await page.goto(path)
      await expect(page.locator("#main-content")).toBeVisible()
      await expect
        .poll(() =>
          page.evaluate(() => ({
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: window.innerWidth
          }))
        )
        .toEqual({ documentWidth: width, viewportWidth: width })

      const offenders = await page.locator("#main-content *").evaluateAll((elements) =>
        elements.flatMap((element) => {
          const box = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          let parent = element.parentElement
          let horizontallyScrollable = false
          while (parent !== null && parent.id !== "main-content") {
            const overflow = getComputedStyle(parent).overflowX
            if (overflow === "auto" || overflow === "scroll") {
              horizontallyScrollable = true
              break
            }
            parent = parent.parentElement
          }
          if (
            box.width === 0 ||
            box.height === 0 ||
            style.position === "absolute" ||
            style.position === "fixed" ||
            horizontallyScrollable ||
            element instanceof SVGElement ||
            (box.left >= -1 && box.right <= window.innerWidth + 1)
          )
            return []
          return [
            `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 80)} (${Math.round(box.left)}..${Math.round(box.right)})`
          ]
        })
      )
      expect(offenders, `${width}px ${path}`).toEqual([])
    }
  }
})
