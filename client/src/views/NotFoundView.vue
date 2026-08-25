<script setup lang="ts">
import { ArrowLeft, MapPinOff } from "lucide-vue-next"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { translate } from "../locales"
import { useSettingsStore } from "../stores/settings"

const settings = useSettingsStore()
const copy = (key: string): string => translate(settings.locale, key)
</script>

<template>
  <section aria-labelledby="not-found-title" class="max-w-2xl">
    <p class="eyebrow">{{ copy("notFound.overline") }}</p>
    <Card class="mt-5 border-l-4 border-l-primary">
      <CardHeader>
        <div class="flex size-10 items-center justify-center rounded-lg bg-accent text-primary">
          <MapPinOff aria-hidden="true" />
        </div>
        <CardTitle id="not-found-title" class="mt-3 text-2xl">{{
          copy("notFound.title")
        }}</CardTitle>
      </CardHeader>
      <CardContent>
        <p class="route-copy text-sm">{{ copy("notFound.copy") }}</p>
        <Button as-child class="mt-6">
          <RouterLink to="/"
            ><ArrowLeft aria-hidden="true" />{{ copy("notFound.action") }}</RouterLink
          >
        </Button>
      </CardContent>
    </Card>
  </section>
</template>
