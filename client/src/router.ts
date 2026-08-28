import { createRouter, createWebHistory } from "vue-router"

import { NAVIGATION_ITEMS } from "./types/navigation"
import HomeView from "./views/HomeView.vue"
import PlaceholderView from "./views/PlaceholderView.vue"
import SettingsView from "./views/SettingsView.vue"
import NotFoundView from "./views/NotFoundView.vue"

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
    placeholderRoute("jobs", "/jobs", "jobs"),
    placeholderRoute("documents", "/documents", "documents"),
    placeholderRoute("jobSearch", "/job-search", "jobSearch"),
    placeholderRoute("stats", "/stats", "stats"),
    { name: "settings", path: "/settings", component: SettingsView },
    { name: "not-found", path: "/:pathMatch(.*)*", component: NotFoundView }
  ]
})

export const requiredRoutePaths = NAVIGATION_ITEMS.map((item) => item.path)
