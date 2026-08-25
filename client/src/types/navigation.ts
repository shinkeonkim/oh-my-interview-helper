export const ROUTE_NAMES = [
  "home",
  "search",
  "jobs",
  "documents",
  "jobSearch",
  "stats",
  "settings"
] as const

export type RouteName = (typeof ROUTE_NAMES)[number]

export type NavigationItem = {
  readonly name: RouteName
  readonly path: string
  readonly number: string
}

export const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { name: "home", path: "/", number: "01" },
  { name: "search", path: "/search", number: "02" },
  { name: "jobs", path: "/jobs", number: "03" },
  { name: "documents", path: "/documents", number: "04" },
  { name: "jobSearch", path: "/job-search", number: "05" },
  { name: "stats", path: "/stats", number: "06" },
  { name: "settings", path: "/settings", number: "07" }
]
