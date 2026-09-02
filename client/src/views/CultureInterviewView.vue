<script setup lang="ts">
import { computed, ref } from "vue"
import { BookOpenCheck, HeartHandshake } from "lucide-vue-next"
import { CULTURE_INTERVIEW_QUESTION_POOL } from "@interview-helper/shared"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { translate } from "../locales"
import { useSettingsStore } from "../stores/settings"
import PreparationView from "./PreparationView.vue"
import ResearchView from "./ResearchView.vue"
import WorkspaceChat from "./WorkspaceChat.vue"

defineProps<{
  companyName: string
  jobPostId: string
  postingTitle: string
  postingVersionId: string | null
  applicationId: string | null
}>()
const settings = useSettingsStore()
const copy = (key: string) => translate(settings.locale, `workspace.${key}`)
const preparationKey = ref(0)
const questionGroups = computed(() => {
  const groups = new Map<string, (typeof CULTURE_INTERVIEW_QUESTION_POOL)[number][]>()
  for (const question of CULTURE_INTERVIEW_QUESTION_POOL) {
    const category = settings.locale === "ko" ? question.category : question.categoryEn
    groups.set(category, [...(groups.get(category) ?? []), question])
  }
  return [...groups.entries()]
})
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
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2"
          ><BookOpenCheck />{{ copy("cultureQuestionPool") }}</CardTitle
        >
        <p class="text-sm leading-6 text-muted-foreground">
          {{ copy("cultureQuestionPoolHelp") }}
        </p>
      </CardHeader>
      <CardContent class="grid gap-3 md:grid-cols-2">
        <details
          v-for="([category, questions], groupIndex) in questionGroups"
          :key="category"
          class="rounded-xl border p-4 open:bg-muted/20"
          :open="groupIndex === 0"
        >
          <summary class="cursor-pointer font-semibold">
            {{ category }} · {{ questions.length }}
          </summary>
          <ol class="mt-4 grid gap-4">
            <li v-for="question in questions" :key="question.id" class="text-sm leading-6">
              <strong class="block">{{
                settings.locale === "ko" ? question.question : question.questionEn
              }}</strong>
              <span class="mt-1 block text-muted-foreground">
                {{ settings.locale === "ko" ? question.answerGuide : question.answerGuideEn }}
              </span>
            </li>
          </ol>
        </details>
        <p class="text-xs leading-5 text-muted-foreground md:col-span-2">
          {{ copy("cultureQuestionPoolSource") }}
          <a
            class="underline"
            target="_blank"
            rel="noreferrer"
            href="https://www.linkedin.com/business/talent/blog/talent-acquisition/guide-to-structuring-effective-interview-process"
            >LinkedIn structured interviews</a
          >
          ·
          <a
            class="underline"
            target="_blank"
            rel="noreferrer"
            href="https://www.indeed.com/career-advice/interviewing/cultural-fit-interview-questions"
            >Indeed culture interview guide</a
          >
        </p>
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
    <section
      v-if="applicationId && postingVersionId"
      class="grid gap-4"
      :aria-label="copy('cultureMockInterview')"
    >
      <div>
        <p class="eyebrow">03 / PRACTICE</p>
        <h2 class="mt-3 text-2xl font-semibold">{{ copy("cultureMockInterview") }}</h2>
        <p class="mt-2 text-sm text-muted-foreground">{{ copy("cultureMockInterviewHelp") }}</p>
      </div>
      <WorkspaceChat
        :application-id="applicationId"
        :job-post-id="jobPostId"
        :posting-title="postingTitle"
        :posting-version-id="postingVersionId"
        practice-mode="culture"
      />
    </section>
    <Card v-else>
      <CardContent class="pt-6 text-sm text-muted-foreground">{{
        copy("cultureMockInterviewUnavailable")
      }}</CardContent>
    </Card>
  </div>
</template>
