<script setup lang="ts">
import { ref } from "vue"
import { HeartHandshake } from "lucide-vue-next"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { translate } from "../locales"
import { useSettingsStore } from "../stores/settings"
import PreparationView from "./PreparationView.vue"
import ResearchView from "./ResearchView.vue"

defineProps<{ companyName: string }>()
const settings = useSettingsStore()
const copy = (key: string) => translate(settings.locale, `workspace.${key}`)
const preparationKey = ref(0)
</script>

<template>
  <div class="grid gap-8">
    <Card class="border-primary/25 bg-primary/5">
      <CardHeader>
        <CardTitle class="flex items-center gap-2"
          ><HeartHandshake />{{ copy("cultureTitle") }}</CardTitle
        >
      </CardHeader>
      <CardContent class="grid gap-2 text-sm leading-6 text-muted-foreground">
        <p>{{ copy("cultureIntro") }}</p>
        <p>{{ copy("cultureReviewNotice") }}</p>
      </CardContent>
    </Card>
    <section class="grid gap-4" :aria-label="copy('cultureResearch')">
      <div>
        <p class="eyebrow">01 / RESEARCH</p>
        <h2 class="mt-3 text-2xl font-semibold">{{ copy("cultureResearch") }}</h2>
        <p class="mt-2 text-sm text-muted-foreground">{{ copy("cultureResearchHelp") }}</p>
      </div>
      <ResearchView
        embedded
        subject-type-preset="company"
        :subject-name-preset="companyName"
        :organization-preset="companyName"
        :role-hint-preset="copy('cultureResearchHint')"
        task-scope-preset="culture"
        @completed="preparationKey += 1"
      />
    </section>
    <section class="grid gap-4" :aria-label="copy('culturePreparation')">
      <div>
        <p class="eyebrow">02 / PREPARE</p>
        <h2 class="mt-3 text-2xl font-semibold">{{ copy("culturePreparation") }}</h2>
        <p class="mt-2 text-sm text-muted-foreground">{{ copy("culturePreparationHelp") }}</p>
      </div>
      <PreparationView :key="preparationKey" embedded workflow-preset="culture_interview" />
    </section>
  </div>
</template>
