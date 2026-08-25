<script setup lang="ts">
import { ArrowRight, FileText, FolderKanban } from "lucide-vue-next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { translate } from "../locales"
import { useSettingsStore } from "../stores/settings"

const settings = useSettingsStore()
const copy = (key: string): string => translate(settings.locale, key)
</script>

<template>
  <div class="grid gap-10 lg:gap-14">
    <section aria-labelledby="home-title" class="max-w-3xl">
      <p class="eyebrow">{{ copy("home.overline") }}</p>
      <h1
        id="home-title"
        class="mt-4 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl"
        style="word-break: keep-all; text-wrap: pretty"
      >
        {{ copy("home.title") }}
      </h1>
      <p class="route-copy mt-5">{{ copy("home.intro") }}</p>
      <div class="mt-7 flex flex-wrap gap-3">
        <Button as-child>
          <RouterLink to="/documents"
            >{{ copy("home.primary") }}<ArrowRight aria-hidden="true"
          /></RouterLink>
        </Button>
        <Button as-child variant="outline">
          <RouterLink to="/jobs">{{ copy("home.secondary") }}</RouterLink>
        </Button>
      </div>
    </section>

    <section class="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]" :aria-label="copy('home.focusTitle')">
      <Card class="border-l-4 border-l-primary">
        <CardHeader class="flex-row items-start justify-between gap-4">
          <div>
            <p class="eyebrow">{{ copy("home.focusMeta") }}</p>
            <CardTitle class="mt-3 text-2xl">{{ copy("home.focusTitle") }}</CardTitle>
          </div>
          <Badge variant="secondary">{{ copy("states.empty") }}</Badge>
        </CardHeader>
        <CardContent>
          <p class="max-w-xl text-sm leading-6 text-muted-foreground">
            {{ copy("home.focusCopy") }}
          </p>
          <Button as-child variant="link" class="mt-5 h-auto px-0">
            <RouterLink to="/settings"
              >{{ copy("nav.settings") }}<ArrowRight aria-hidden="true"
            /></RouterLink>
          </Button>
        </CardContent>
      </Card>
      <Card class="bg-muted/45">
        <CardHeader>
          <div class="flex size-10 items-center justify-center rounded-lg bg-accent text-primary">
            <FolderKanban aria-hidden="true" />
          </div>
          <CardTitle class="mt-2 text-xl">{{ copy("home.noteTitle") }}</CardTitle>
        </CardHeader>
        <CardContent>
          <p class="text-sm leading-6 text-muted-foreground">{{ copy("home.noteCopy") }}</p>
        </CardContent>
      </Card>
    </section>

    <section
      class="grid gap-4 border-t border-border pt-6 sm:grid-cols-[auto_1fr] sm:items-start"
      :aria-label="copy('states.loading')"
    >
      <div
        class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"
      >
        <FileText aria-hidden="true" class="size-4 text-primary" />
        {{ copy("states.loading") }}
      </div>
      <div>
        <Separator class="mb-4 sm:hidden" />
        <p class="text-sm leading-6 text-muted-foreground">{{ copy("home.focusCopy") }}</p>
      </div>
    </section>
  </div>
</template>
