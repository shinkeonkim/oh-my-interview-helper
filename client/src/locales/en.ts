import type { LocaleMessages } from "./messages"

export const en = {
  brand: {
    eyebrow: "INTERVIEW PREP LAB",
    name: "Interview Helper",
    mark: "IH",
    tagline: "Collect evidence from your career. Prepare for the next question."
  },
  nav: {
    label: "Primary navigation",
    home: "Home",
    search: "Search",
    jobs: "Job postings",
    documents: "Documents",
    jobSearch: "Job search",
    stats: "Stats",
    settings: "Settings"
  },
  actions: {
    openMenu: "Open menu",
    closeMenu: "Close menu",
    skip: "Skip to main content",
    language: "한국어",
    languageLabel: "Switch language to Korean",
    lightMode: "Switch to light mode",
    darkMode: "Switch to dark mode",
    close: "Close",
    save: "Save",
    retry: "Try again",
    search: "Search",
    openSearch: "Open search",
    searchHint: "Find a screen or workspace",
    searchDescription: "Search the available preparation workspaces.",
    searchPlaceholder: "Type a screen name",
    searchEmpty: "No matching screens",
    themeLabel: "Choose theme",
    sidebarToggle: "Toggle sidebar",
    homeLabel: "Interview Helper home"
  },
  home: {
    overline: "TODAY'S PREP",
    title: "Good answers\nstart with good notes.",
    intro: "Bring the context of each role and the evidence behind your work into one calm place.",
    primary: "Add your first record",
    secondary: "Browse job postings",
    focusTitle: "This week's focus",
    focusCopy:
      "Nothing is connected yet. Add a document or posting and this space will suggest what to prepare next.",
    focusMeta: "Preparation space",
    noteTitle: "Start with one useful thing",
    noteCopy:
      "This shell does not hide an empty state. Once real material arrives, the next step will continue here."
  },
  placeholder: {
    search: {
      overline: "DISCOVER",
      title: "Search",
      copy: "Find documents, postings, and preparation notes in one place."
    },
    jobs: {
      overline: "APPLICATIONS",
      title: "Job postings",
      copy: "Keep roles of interest and their application stages together."
    },
    documents: {
      overline: "SOURCE MATERIAL",
      title: "Documents",
      copy: "Keep resume and portfolio versions ready for review."
    },
    jobSearch: {
      overline: "NEW OPPORTUNITIES",
      title: "Job search",
      copy: "Explore public job information and save what deserves a closer look."
    },
    stats: {
      overline: "YOUR RHYTHM",
      title: "Stats",
      copy: "Review your preparation rhythm without invented numbers."
    },
    emptyTitle: "There is nothing to show yet",
    emptyCopy:
      "This is the place for the next feature flow. For now, the empty state is explicit and safe."
  },
  settings: {
    overline: "ENVIRONMENT",
    title: "Settings",
    copy: "Tune the reading environment and defaults for your preparation desk.",
    preferences: "Reading environment",
    language: "Language",
    languageHelp: "The language used for navigation and guidance.",
    theme: "Theme",
    themeHelp: "A dark theme can reduce eye strain in low-light rooms.",
    system: "System",
    light: "Light",
    dark: "Dark",
    saved: "Your preferences are saved in this browser.",
    accessibility: "Accessibility baseline",
    accessibilityCopy:
      "Every primary action is keyboard reachable and follows the system reduced-motion preference."
  },
  notFound: {
    overline: "ROUTE CHECK",
    title: "This space is not available",
    copy: "Check the address or choose a workspace from the primary navigation.",
    action: "Go home"
  },
  states: {
    loading: "Loading",
    error: "Something went wrong",
    empty: "Empty",
    placeholder: "In progress"
  },
  footer: "A local-first interview preparation tool"
} satisfies LocaleMessages
