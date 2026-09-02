export type HealthStatus = {
  readonly status: "ok"
}

export const HEALTH_STATUS = { status: "ok" } as const satisfies HealthStatus

export type CultureInterviewQuestion = {
  readonly id: string
  readonly category: string
  readonly question: string
  readonly answerGuide: string
}

// Structured behavioral and situational questions synthesized from public interview guidance.
// The company-specific agent adapts this baseline rather than treating it as company evidence.
export const CULTURE_INTERVIEW_QUESTION_POOL = [
  {
    id: "motivation",
    category: "지원 동기와 가치",
    question: "왜 이 회사와 이 역할을 선택했으며, 어떤 가치가 본인과 맞습니까?",
    answerGuide: "회사 근거와 실제 경험을 연결하고 일방적인 찬양보다 상호 적합성을 설명합니다."
  },
  {
    id: "culture-add",
    category: "지원 동기와 가치",
    question: "우리 문화에 적응하는 것을 넘어 새롭게 더할 수 있는 관점이나 방식은 무엇입니까?",
    answerGuide: "기존 문화를 존중하면서 팀에 더할 구체적인 행동과 경험을 제시합니다."
  },
  {
    id: "collaboration",
    category: "협업과 갈등",
    question: "관점이나 업무 방식이 다른 동료와 성과를 만든 경험을 설명해 주세요.",
    answerGuide: "차이를 확인한 과정, 본인의 행동, 합의와 결과를 STAR 구조로 답합니다."
  },
  {
    id: "conflict",
    category: "협업과 갈등",
    question: "팀의 결정에 동의하지 않았을 때 어떻게 행동했습니까?",
    answerGuide: "반대 근거를 전달한 방식과 결정 이후의 책임 있는 실행을 함께 보여줍니다."
  },
  {
    id: "feedback",
    category: "피드백과 성장",
    question: "받기 어려웠지만 행동을 바꾸게 한 피드백은 무엇이었습니까?",
    answerGuide: "방어적 반응을 관리하고 행동을 바꾼 과정과 확인 가능한 변화를 말합니다."
  },
  {
    id: "failure",
    category: "피드백과 성장",
    question: "실패하거나 기대에 미치지 못한 경험과 이후 달라진 점을 설명해 주세요.",
    answerGuide: "책임을 회피하지 않고 학습과 재발 방지 행동을 구체적으로 답합니다."
  },
  {
    id: "ownership",
    category: "주도성과 판단",
    question: "역할의 경계를 넘어 문제를 발견하고 주도적으로 해결한 경험이 있습니까?",
    answerGuide: "왜 개입했는지, 이해관계자를 어떻게 정렬했는지, 결과가 무엇인지 설명합니다."
  },
  {
    id: "ambiguity",
    category: "주도성과 판단",
    question: "정보가 부족하거나 우선순위가 자주 바뀌는 상황에서 어떻게 판단합니까?",
    answerGuide: "가정, 확인 절차, 작은 실행, 위험 관리와 공유 방식을 보여줍니다."
  },
  {
    id: "customer",
    category: "고객과 성과",
    question: "고객이나 사용자의 필요와 내부 요구가 충돌했을 때 어떻게 결정했습니까?",
    answerGuide: "대상을 명확히 하고 데이터와 제약을 바탕으로 한 트레이드오프를 설명합니다."
  },
  {
    id: "work-style",
    category: "업무 방식",
    question: "가장 좋은 성과를 내는 업무 환경과 협업 방식은 무엇입니까?",
    answerGuide: "선호만 말하지 말고 다른 환경에 적응한 사례와 필요한 지원을 함께 답합니다."
  },
  {
    id: "manager",
    category: "업무 방식",
    question: "어떤 리더십에서 잘 일하며, 맞지 않는 방식에는 어떻게 대응합니까?",
    answerGuide: "특정 사람을 비판하지 않고 기대치 정렬과 소통 방법을 중심으로 설명합니다."
  },
  {
    id: "reverse-question",
    category: "상호 검증",
    question: "입사 전 반드시 확인하고 싶은 팀 문화나 일하는 방식은 무엇입니까?",
    answerGuide: "공개된 가치가 실제 의사결정과 피드백 과정에서 어떻게 작동하는지 질문합니다."
  }
] as const satisfies readonly CultureInterviewQuestion[]
