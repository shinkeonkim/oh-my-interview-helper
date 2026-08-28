export const ko = {
  brand: {
    eyebrow: "인터뷰 준비 연구실",
    name: "Interview Helper",
    mark: "IH",
    tagline: "경력의 근거를 모으고, 다음 질문을 준비합니다."
  },
  nav: {
    label: "주요 메뉴",
    home: "홈",
    search: "통합 검색",
    jobs: "채용 공고",
    documents: "문서 보관함",
    jobSearch: "채용 탐색",
    stats: "통계",
    settings: "설정"
  },
  actions: {
    openMenu: "메뉴 열기",
    closeMenu: "메뉴 닫기",
    skip: "본문으로 건너뛰기",
    language: "English",
    languageLabel: "언어를 English로 변경",
    lightMode: "Switch to light mode",
    darkMode: "Switch to dark mode",
    close: "닫기",
    save: "저장",
    retry: "다시 시도",
    search: "검색",
    openSearch: "검색 열기",
    searchHint: "메뉴와 화면 찾기",
    searchDescription: "이동할 화면이나 준비 공간을 검색합니다.",
    searchPlaceholder: "화면 이름을 입력하세요",
    searchEmpty: "일치하는 화면이 없습니다",
    themeLabel: "테마 선택",
    sidebarToggle: "사이드바 전환",
    homeLabel: "Interview Helper 홈"
  },
  home: {
    overline: "오늘의 준비",
    title: "좋은 답변은\n좋은 기록에서 시작됩니다.",
    intro: "지원한 역할의 맥락과 내가 해낸 일의 근거를 한 곳에서 차분히 정리하세요.",
    primary: "첫 기록 남기기",
    secondary: "채용 공고 살펴보기",
    focusTitle: "이번 주의 초점",
    focusCopy:
      "아직 연결된 기록이 없습니다. 문서나 공고를 추가하면 이 공간이 다음 준비 순서를 안내합니다.",
    focusMeta: "준비 공간",
    noteTitle: "작게 시작해도 됩니다",
    noteCopy:
      "이 셸은 현재 빈 상태를 숨기지 않습니다. 실제 자료가 들어오면 여기서 흐름이 이어집니다."
  },
  placeholder: {
    search: {
      overline: "발견",
      title: "통합 검색",
      copy: "문서, 공고, 준비 기록을 한 번에 찾는 공간입니다."
    },
    jobs: {
      overline: "지원 관리",
      title: "채용 공고",
      copy: "관심 있는 역할과 지원 단계를 정리하는 공간입니다."
    },
    documents: {
      overline: "근거 자료",
      title: "문서 보관함",
      copy: "이력서와 포트폴리오 버전을 안전하게 모아두는 공간입니다."
    },
    jobSearch: {
      overline: "새로운 기회",
      title: "채용 탐색",
      copy: "공개된 채용 정보를 살펴보고 나중에 검토할 수 있는 공간입니다."
    },
    stats: {
      overline: "리듬 보기",
      title: "통계",
      copy: "준비의 흐름을 과장 없이 돌아보는 공간입니다."
    },
    emptyTitle: "아직 보여드릴 기록이 없습니다",
    emptyCopy:
      "이 화면은 다음 단계의 기능이 연결될 자리입니다. 지금은 비어 있는 상태를 명확하게 보여줍니다."
  },
  settings: {
    overline: "환경",
    title: "설정",
    copy: "읽는 환경과 인터뷰 준비 공간의 기본값을 조정합니다.",
    preferences: "읽기 환경",
    language: "언어",
    languageHelp: "메뉴와 안내 문구에 사용할 언어입니다.",
    theme: "화면 테마",
    themeHelp: "빛이 적은 곳에서는 어두운 테마가 눈의 피로를 줄일 수 있습니다.",
    system: "시스템",
    light: "라이트",
    dark: "다크",
    saved: "설정이 이 브라우저에 저장되었습니다.",
    accessibility: "접근성 기준",
    accessibilityCopy:
      "모든 주요 동작은 키보드로 사용할 수 있고, 시스템의 모션 줄이기 설정을 따릅니다."
  },
  notFound: {
    overline: "경로 확인",
    title: "이 공간은 아직 없습니다",
    copy: "주소를 확인하거나 주요 메뉴에서 준비 공간을 선택하세요.",
    action: "홈으로 이동"
  },
  states: {
    loading: "불러오는 중입니다",
    error: "문제가 생겼습니다",
    empty: "비어 있음",
    placeholder: "준비 중"
  },
  footer: "로컬 우선 인터뷰 준비 도구"
} as const
