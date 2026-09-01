import { describe, expect, test } from "bun:test"

import {
  JobDiscoveryError,
  mergeJobRecommendations,
  parseJobDiscoveryOutput,
  splitDiscoveryPlatforms
} from "../src/job-search/service"

const valid = {
  title: "Backend Engineer",
  company: "Acme",
  url: "https://example.com/jobs/1",
  platform: "official",
  summary: "A live backend role",
  score: 91.6,
  breakdown: { profile: 101, criteria: "84", freshness: 79.4 },
  rationale: "The role matches the selected profile."
}

describe("공개 채용 탐색 결과 복구", () => {
  test("유효한 추천은 보정하고 잘못된 개별 추천만 제외한다", () => {
    const result = parseJobDiscoveryOutput(
      JSON.stringify({ recommendations: [{ title: "missing fields" }, valid] })
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      score: 92,
      location: null,
      experience: null,
      companySize: null,
      matchedSkills: [],
      gaps: [],
      breakdown: { profile: 100, criteria: 84, freshness: 79 }
    })
  })

  test("추천이 모두 잘못되면 성공으로 위장하지 않는다", () => {
    expect(() => parseJobDiscoveryOutput('{"recommendations":[{"title":"broken"}]}')).toThrow(
      JobDiscoveryError
    )
  })

  test("플랫폼을 두 개씩 나누고 중복 공고는 높은 점수 하나만 남긴다", () => {
    expect(
      splitDiscoveryPlatforms([
        "wanted",
        "saramin",
        "jobkorea",
        "remember",
        "greeting",
        "inthiswork"
      ])
    ).toEqual([
      ["wanted", "saramin"],
      ["jobkorea", "remember"],
      ["greeting", "inthiswork"]
    ])

    const first = parseJobDiscoveryOutput(JSON.stringify({ recommendations: [valid] }))[0]!
    const higher = { ...first, url: `${first.url}?tracking=second`, score: 97 }
    expect(mergeJobRecommendations([[first], [higher]])).toEqual([higher])
  })
})
