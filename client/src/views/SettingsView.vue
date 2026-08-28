<script setup lang="ts">
import { computed } from "vue"
import { toast } from "vue-sonner"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { translate } from "../locales"
import { useSettingsStore, type Theme } from "../stores/settings"

const settings = useSettingsStore()
const copy = (key: string): string => translate(settings.locale, key)

const localeValue = computed({
  get: () => settings.locale,
  set: (value: string): void => {
    settings.setLocale(value === "en" ? "en" : "ko")
    toast.success(copy("settings.saved"))
  }
})

const themeValue = computed({
  get: () => settings.theme,
  set: (value: string): void => {
    const nextTheme: Theme = value === "light" || value === "dark" ? value : "system"
    settings.setTheme(nextTheme)
    toast.success(copy("settings.saved"))
  }
})
</script>

<template>
  <div class="grid gap-10">
    <section aria-labelledby="settings-title" class="max-w-3xl">
      <p class="eyebrow">{{ copy("settings.overline") }}</p>
      <h1 id="settings-title" class="page-title mt-4">{{ copy("settings.title") }}</h1>
      <p class="route-copy mt-4">{{ copy("settings.copy") }}</p>
    </section>

    <Card class="max-w-3xl">
      <CardHeader>
        <CardTitle>{{ copy("settings.preferences") }}</CardTitle>
        <CardDescription>{{ copy("settings.saved") }}</CardDescription>
      </CardHeader>
      <CardContent class="grid gap-6">
        <div class="grid gap-3 sm:grid-cols-[1fr_13rem] sm:items-center">
          <div>
            <Label for="locale-select">{{ copy("settings.language") }}</Label>
            <p id="locale-help" class="mt-1 text-sm leading-6 text-muted-foreground">
              {{ copy("settings.languageHelp") }}
            </p>
          </div>
          <Select v-model="localeValue">
            <SelectTrigger id="locale-select" aria-describedby="locale-help">
              <SelectValue :placeholder="copy('settings.language')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ko">한국어</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Separator />
        <div class="grid gap-3 sm:grid-cols-[1fr_13rem] sm:items-center">
          <div>
            <Label for="theme-select">{{ copy("settings.theme") }}</Label>
            <p id="theme-help" class="mt-1 text-sm leading-6 text-muted-foreground">
              {{ copy("settings.themeHelp") }}
            </p>
          </div>
          <Select v-model="themeValue">
            <SelectTrigger id="theme-select" aria-describedby="theme-help">
              <SelectValue :placeholder="copy('settings.theme')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">{{ copy("settings.system") }}</SelectItem>
              <SelectItem value="light">{{ copy("settings.light") }}</SelectItem>
              <SelectItem value="dark">{{ copy("settings.dark") }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>

    <section aria-labelledby="accessibility-title" class="max-w-3xl border-t border-border pt-6">
      <p class="eyebrow">{{ copy("settings.accessibility") }}</p>
      <h2 id="accessibility-title" class="mt-3 text-xl font-semibold tracking-tight">
        {{ copy("settings.accessibility") }}
      </h2>
      <p class="route-copy mt-3 text-sm">{{ copy("settings.accessibilityCopy") }}</p>
    </section>
  </div>
</template>
