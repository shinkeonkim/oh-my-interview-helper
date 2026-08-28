<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { RouterLink, useRoute, useRouter } from "vue-router"
import {
  BriefcaseBusiness,
  ChartNoAxesColumnIncreasing,
  Compass,
  FileText,
  House,
  Languages,
  Monitor,
  Moon,
  Search,
  Settings2,
  Sun
} from "lucide-vue-next"
import type { Component } from "vue"

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut
} from "@/components/ui/command"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from "@/components/ui/sheet"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger
} from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { translate } from "../locales"
import { useSettingsStore, type Theme } from "../stores/settings"
import { NAVIGATION_ITEMS, type RouteName } from "../types/navigation"

const settings = useSettingsStore()
const route = useRoute()
const router = useRouter()
const mobileOpen = ref(false)
const searchOpen = ref(false)

const navIcons = {
  home: House,
  search: Search,
  jobs: BriefcaseBusiness,
  documents: FileText,
  jobSearch: Compass,
  stats: ChartNoAxesColumnIncreasing,
  settings: Settings2
} satisfies Record<RouteName, Component>

const copy = (key: string): string => translate(settings.locale, key)
const currentRouteLabel = computed(() => {
  const currentItem = NAVIGATION_ITEMS.find((item) => item.name === route.name)
  return currentItem ? copy(`nav.${currentItem.name}`) : copy("notFound.title")
})
const themeLabel = computed(() => copy(`settings.${settings.theme}`))
const themeIcon = computed(() => {
  if (settings.theme === "dark") return Moon
  if (settings.theme === "light") return Sun
  return Monitor
})

const isRouteActive = (path: string): boolean =>
  path === "/" ? route.path === "/" : route.path === path || route.path.startsWith(`${path}/`)

const goTo = (path: string): void => {
  searchOpen.value = false
  mobileOpen.value = false
  void router.push(path)
}

const changeTheme = (theme: Theme): void => settings.setTheme(theme)
const toggleLocale = (): void => settings.setLocale(settings.locale === "ko" ? "en" : "ko")

const onGlobalKeydown = (event: KeyboardEvent): void => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault()
    searchOpen.value = true
  }
}

onMounted(() => window.addEventListener("keydown", onGlobalKeydown))
onBeforeUnmount(() => window.removeEventListener("keydown", onGlobalKeydown))
</script>

<template>
  <a class="skip-link" href="#main-content">{{ copy("actions.skip") }}</a>
  <TooltipProvider>
    <SidebarProvider>
      <Sidebar
        data-shell-primitive="sidebar"
        collapsible="icon"
        class="hidden border-sidebar-border bg-sidebar md:flex"
      >
        <SidebarHeader
          class="border-b border-sidebar-border px-4 py-5 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-2"
        >
          <RouterLink
            to="/"
            class="flex items-center gap-3 rounded-md p-2 group-data-[collapsible=icon]:justify-center"
            :aria-label="copy('actions.homeLabel')"
          >
            <span
              class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
            >
              IH
            </span>
            <span class="min-w-0 group-data-[collapsible=icon]:hidden">
              <span class="block truncate text-sm font-semibold tracking-tight">{{
                copy("brand.name")
              }}</span>
              <span class="block truncate text-xs text-muted-foreground">{{
                copy("brand.eyebrow")
              }}</span>
            </span>
          </RouterLink>
        </SidebarHeader>
        <SidebarContent class="px-3 py-5 group-data-[collapsible=icon]:px-2">
          <SidebarGroup class="group-data-[collapsible=icon]:p-0">
            <SidebarGroupLabel>{{ copy("nav.label") }}</SidebarGroupLabel>
            <SidebarGroupContent>
              <nav :aria-label="copy('nav.label')">
                <SidebarMenu>
                  <SidebarMenuItem v-for="item in NAVIGATION_ITEMS" :key="item.name">
                    <SidebarMenuButton
                      as-child
                      :is-active="isRouteActive(item.path)"
                      :tooltip="copy(`nav.${item.name}`)"
                      class="h-10 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0"
                    >
                      <RouterLink
                        :to="item.path"
                        :aria-current="isRouteActive(item.path) ? 'page' : undefined"
                      >
                        <component :is="navIcons[item.name]" aria-hidden="true" />
                        <span class="group-data-[collapsible=icon]:hidden">{{
                          copy(`nav.${item.name}`)
                        }}</span>
                        <span
                          class="ml-auto font-mono text-[0.6875rem] text-muted-foreground group-data-[collapsible=icon]:hidden"
                          >{{ item.number }}</span
                        >
                      </RouterLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </nav>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter
          class="gap-3 border-t border-sidebar-border px-4 py-4 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-2"
        >
          <p class="text-xs leading-5 text-muted-foreground group-data-[collapsible=icon]:hidden">
            {{ copy("brand.tagline") }}
          </p>
          <span
            class="font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-primary group-data-[collapsible=icon]:hidden"
            >LOCAL / 01</span
          >
        </SidebarFooter>
      </Sidebar>

      <SidebarInset class="min-w-0 bg-background">
        <header
          class="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-3 border-b border-border/80 bg-background/95 px-4 backdrop-blur sm:px-6"
        >
          <div class="flex min-w-0 items-center gap-2">
            <SidebarTrigger
              class="hidden md:inline-flex"
              :aria-label="copy('actions.sidebarToggle')"
            />
            <Sheet v-model:open="mobileOpen">
              <SheetTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="md:hidden"
                  :aria-label="copy('actions.openMenu')"
                >
                  <Compass aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent
                data-shell-primitive="sheet"
                side="left"
                class="w-[min(88vw,20rem)] bg-sidebar px-4"
              >
                <SheetHeader class="border-b border-sidebar-border pb-5 text-left">
                  <SheetTitle>{{ copy("brand.name") }}</SheetTitle>
                  <SheetDescription>{{ copy("brand.tagline") }}</SheetDescription>
                </SheetHeader>
                <nav class="mt-6" :aria-label="copy('nav.label')">
                  <div class="grid gap-1">
                    <Button
                      v-for="item in NAVIGATION_ITEMS"
                      :key="item.name"
                      as-child
                      variant="ghost"
                      class="h-11 justify-start gap-3 px-3"
                      :class="isRouteActive(item.path) ? 'bg-accent text-accent-foreground' : ''"
                      @click="mobileOpen = false"
                    >
                      <RouterLink
                        :to="item.path"
                        :aria-current="isRouteActive(item.path) ? 'page' : undefined"
                      >
                        <component :is="navIcons[item.name]" aria-hidden="true" />
                        <span>{{ copy(`nav.${item.name}`) }}</span>
                      </RouterLink>
                    </Button>
                  </div>
                </nav>
              </SheetContent>
            </Sheet>
            <div class="hidden min-w-0 sm:block">
              <p class="truncate text-sm font-medium">{{ currentRouteLabel }}</p>
              <p class="truncate text-xs text-muted-foreground">{{ copy("brand.tagline") }}</p>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-1 sm:gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    variant="outline"
                    size="sm"
                    class="h-9 gap-2 px-2.5 sm:min-w-44 sm:justify-start"
                    :aria-label="copy('actions.openSearch')"
                    @click="searchOpen = true"
                  >
                    <Search aria-hidden="true" />
                    <span class="hidden text-xs text-muted-foreground sm:inline">{{
                      copy("actions.search")
                    }}</span>
                    <kbd
                      class="ml-auto hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted-foreground sm:inline"
                      >⌘K</kbd
                    >
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{{ copy("actions.searchHint") }}</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <Button
              variant="ghost"
              size="icon"
              :aria-label="copy('actions.languageLabel')"
              data-locale-toggle
              @click="toggleLocale"
            >
              <Languages aria-hidden="true" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button
                  variant="ghost"
                  size="sm"
                  class="gap-2 px-2.5"
                  :aria-label="copy('actions.themeLabel')"
                  data-theme-toggle
                >
                  <component :is="themeIcon" aria-hidden="true" />
                  <span class="hidden text-xs sm:inline">{{ themeLabel }}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-44">
                <DropdownMenuLabel>{{ copy("settings.theme") }}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem @select="changeTheme('system')"
                  ><Monitor aria-hidden="true" />{{ copy("settings.system") }}</DropdownMenuItem
                >
                <DropdownMenuItem @select="changeTheme('light')"
                  ><Sun aria-hidden="true" />{{ copy("settings.light") }}</DropdownMenuItem
                >
                <DropdownMenuItem @select="changeTheme('dark')"
                  ><Moon aria-hidden="true" />{{ copy("settings.dark") }}</DropdownMenuItem
                >
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div
          id="main-content"
          tabindex="-1"
          class="min-h-[calc(100svh-4rem)] min-w-0 px-4 py-8 sm:px-6 sm:py-10 lg:px-10"
        >
          <div class="mx-auto w-full max-w-6xl">
            <slot />
          </div>
        </div>
        <footer
          class="flex flex-wrap items-center justify-between gap-3 border-t border-border/80 px-4 py-4 text-xs text-muted-foreground sm:px-6 lg:px-10"
        >
          <span>{{ copy("footer") }}</span>
          <span class="font-mono">v0.1 / {{ copy("states.placeholder") }}</span>
        </footer>
      </SidebarInset>
    </SidebarProvider>
  </TooltipProvider>

  <CommandDialog
    v-model:open="searchOpen"
    :title="copy('actions.search')"
    :description="copy('actions.searchDescription')"
  >
    <CommandInput :placeholder="copy('actions.searchPlaceholder')" />
    <CommandList>
      <CommandEmpty>{{ copy("actions.searchEmpty") }}</CommandEmpty>
      <CommandGroup :heading="copy('nav.label')">
        <CommandItem
          v-for="item in NAVIGATION_ITEMS"
          :key="item.name"
          :value="`${copy(`nav.${item.name}`)} ${item.path}`"
          @select="goTo(item.path)"
        >
          <component :is="navIcons[item.name]" aria-hidden="true" />
          <span>{{ copy(`nav.${item.name}`) }}</span>
          <CommandShortcut>{{ item.number }}</CommandShortcut>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </CommandDialog>
</template>
