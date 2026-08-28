import { createRouter, createWebHistory } from "vue-router"

import { NAVIGATION_ITEMS } from "./types/navigation"
import HomeView from "./views/HomeView.vue"
import PlaceholderView from "./views/PlaceholderView.vue"
import SettingsView from "./views/SettingsView.vue"
import NotFoundView from "./views/NotFoundView.vue"
import DocumentsView from "./views/DocumentsView.vue"
import ApplicationsView from "./views/ApplicationsView.vue"
import ResearchView from "./views/ResearchView.vue"
import JobWorkspaceView from "./views/JobWorkspaceView.vue"
import PreparationView from "./views/PreparationView.vue"

const placeholderRoute = (name: string, path: string, key: string) => ({
  name,
  path,
  component: PlaceholderView,
  props: { contentKey: key }
})

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { name: "home", path: "/", component: HomeView },
    placeholderRoute("search", "/search", "search"),
    { name: "jobs", path: "/jobs", component: ApplicationsView },
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
      component: JobWorkspaceView,
      props: { area }
    })),
    { name: "preparation", path: "/jobs/:postId/prepare", component: PreparationView },
    { name: "documents", path: "/documents", component: DocumentsView },
    { name: "jobSearch", path: "/job-search", component: ResearchView },
    placeholderRoute("stats", "/stats", "stats"),
    { name: "settings", path: "/settings", component: SettingsView },
    { name: "not-found", path: "/:pathMatch(.*)*", component: NotFoundView }
  ]
})

export const requiredRoutePaths = NAVIGATION_ITEMS.map((item) => item.path)
