import { createRouter, createWebHistory } from "vue-router"

import { NAVIGATION_ITEMS } from "./types/navigation"
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { name: "home", path: "/", component: () => import("./views/HomeView.vue") },
    { name: "search", path: "/search", component: () => import("./views/SearchView.vue") },
    { name: "jobs", path: "/jobs", component: () => import("./views/ApplicationsView.vue") },
    {
      name: "workspace",
      path: "/jobs/:postId",
      redirect: (to) => `/jobs/${String(to.params["postId"])}/overview`
    },
    ...(
      [
        ["overview", "workspace-overview"],
        ["company", "workspace-company"],
        ["people", "workspace-people"],
        ["resume", "workspace-resume"],
        ["interview", "workspace-interview"],
        ["technical", "workspace-technical"],
        ["topics", "workspace-topics"]
      ] as const
    ).map(([area, name]) => ({
      name,
      path: `/jobs/:postId/${area}`,
      component: () => import("./views/JobWorkspaceView.vue"),
      props: { area }
    })),
    {
      name: "preparation",
      path: "/jobs/:postId/prepare",
      component: () => import("./views/PreparationView.vue")
    },
    { name: "documents", path: "/documents", component: () => import("./views/DocumentsView.vue") },
    {
      name: "jobSearch",
      path: "/job-search",
      component: () => import("./views/JobSearchView.vue")
    },
    { name: "research", path: "/research", component: () => import("./views/ResearchView.vue") },
    { name: "stats", path: "/stats", component: () => import("./views/StatsView.vue") },
    { name: "settings", path: "/settings", component: () => import("./views/SettingsView.vue") },
    {
      name: "not-found",
      path: "/:pathMatch(.*)*",
      component: () => import("./views/NotFoundView.vue")
    }
  ]
})

export const requiredRoutePaths = NAVIGATION_ITEMS.map((item) => item.path)
