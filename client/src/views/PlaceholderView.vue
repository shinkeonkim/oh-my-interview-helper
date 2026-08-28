<script setup lang="ts">
import { Construction, Settings2 } from "lucide-vue-next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { translate } from "../locales"
import { useSettingsStore } from "../stores/settings"

type PlaceholderKey = "search" | "jobs" | "documents" | "jobSearch" | "stats"

const props = defineProps<{ readonly contentKey: PlaceholderKey }>()
const settings = useSettingsStore()
const copy = (key: string): string => translate(settings.locale, key)
</script>

<template>
  <div class="grid gap-10">
    <section aria-labelledby="placeholder-title" class="max-w-3xl">
      <p class="eyebrow">{{ copy(`placeholder.${props.contentKey}.overline`) }}</p>
      <h1 id="placeholder-title" class="page-title mt-4">
        {{ copy(`placeholder.${props.contentKey}.title`) }}
      </h1>
      <p class="route-copy mt-4">{{ copy(`placeholder.${props.contentKey}.copy`) }}</p>
    </section>
    <Card class="max-w-3xl border-l-4 border-l-primary">
      <CardHeader class="flex-row items-start gap-4">
        <div
          class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary"
        >
          <Construction aria-hidden="true" />
        </div>
        <div>
          <Badge variant="outline">{{ copy("states.empty") }}</Badge>
          <CardTitle class="mt-3 text-xl">{{ copy("placeholder.emptyTitle") }}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <p class="max-w-xl text-sm leading-6 text-muted-foreground">
          {{ copy("placeholder.emptyCopy") }}
        </p>
        <Button as-child variant="outline" class="mt-6">
          <RouterLink to="/settings"
            ><Settings2 aria-hidden="true" />{{ copy("nav.settings") }}</RouterLink
          >
        </Button>
      </CardContent>
    </Card>
  </div>
</template>
