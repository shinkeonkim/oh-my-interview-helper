<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { RouterLink, useRoute } from "vue-router"
import { ArrowLeft, ArrowRight, Building2, CalendarClock, ListTodo, Users } from "lucide-vue-next"
import { toast } from "vue-sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import PreparationView from "./PreparationView.vue"
import ResearchView from "./ResearchView.vue"
import WorkspaceChat from "./WorkspaceChat.vue"
import { translate } from "../locales"
import { useSettingsStore } from "../stores/settings"

type Area = "overview" | "company" | "people" | "resume" | "interview" | "technical" | "topics"
type Posting = {
  id: string
  title: string
  companyName: string
  teamName: string | null
  versionNumber: number | null
  currentVersionId: string | null
}
type Application = { id: string; jobPostId: string; stageName: string; appliedAt: string | null }
type Interview = { id: string; scheduledAt: string; kind: string }

const props = defineProps<{ area: Area }>()
const route = useRoute()
const settings = useSettingsStore()
const copy = (key: string) => translate(settings.locale, `workspace.${key}`)
const controller = new AbortController()
const postings = ref<Posting[]>([])
const applications = ref<Application[]>([])
const interviews = ref<Interview[]>([])
const researchCount = ref(0)
let loadRequestId = 0
const postId = computed(() => String(route.params["postId"] ?? ""))
const posting = computed(() => postings.value.find((item) => item.id === postId.value) ?? null)
const application = computed(
  () => applications.value.find((item) => item.jobPostId === postId.value) ?? null
)
const areas: readonly Area[] = [
  "overview",
  "company",
  "people",
  "resume",
  "interview",
  "technical",
  "topics"
]
const workflow = computed(
  () =>
    (
      ({
        resume: "resume_feedback",
        interview: "interview_prep",
        technical: "technical_prep",
        topics: "topic_answers"
      }) as const
    )[props.area as "resume" | "interview" | "technical" | "topics"]
)
const nextActions = computed(() => [
  { key: "research", done: researchCount.value > 0, to: "/jobs/" + postId.value + "/company" },
  { key: "documents", done: false, to: "/jobs/" + postId.value + "/resume" },
  {
    key: "interview",
    done: interviews.value.length > 0,
    to: "/jobs/" + postId.value + "/interview"
  }
])

const load = async () => {
  const requestId = ++loadRequestId
  const requestedPostId = postId.value
  try {
    const [postResponse, applicationResponse, researchResponse] = await Promise.all([
      fetch("/api/postings", { signal: controller.signal }),
      fetch("/api/applications", { signal: controller.signal }),
      fetch("/api/research?jobPostId=" + encodeURIComponent(requestedPostId), {
        signal: controller.signal
      })
    ])
    if (!postResponse.ok || !applicationResponse.ok || !researchResponse.ok)
      throw new Error("request")
    const [postValue, applicationValue, researchValue] = await Promise.all([
      postResponse.json() as Promise<{ postings: Posting[] }>,
      applicationResponse.json() as Promise<{ applications: Application[] }>,
      researchResponse.json() as Promise<{ records: unknown[] }>
    ])
    const requestedApplication = applicationValue.applications.find(
      (item) => item.jobPostId === requestedPostId
    )
    let requestedInterviews: Interview[] = []
    if (requestedApplication !== undefined) {
      const response = await fetch(`/api/applications/${requestedApplication.id}/history`, {
        signal: controller.signal
      })
      if (!response.ok) throw new Error("request")
      requestedInterviews = ((await response.json()) as { interviews: Interview[] }).interviews
    }
    if (requestId !== loadRequestId || requestedPostId !== postId.value) return
    postings.value = postValue.postings
    applications.value = applicationValue.applications
    interviews.value = requestedInterviews
    researchCount.value = researchValue.records.length
  } catch (error) {
    if (requestId === loadRequestId) throw error
  }
}
watch(
  postId,
  () => {
    interviews.value = []
    void load().catch(() => toast.error(copy("failed")))
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  loadRequestId += 1
  controller.abort()
})
</script>

<template>
  <div class="grid gap-6">
    <header class="grid gap-4">
      <Button as-child variant="ghost" class="w-fit"
        ><RouterLink to="/jobs"><ArrowLeft />{{ copy("back") }}</RouterLink></Button
      >
      <div>
        <p class="eyebrow">{{ copy("overline") }}</p>
        <h1 class="page-title mt-3">{{ posting?.title ?? copy("overview") }}</h1>
        <p class="route-copy mt-2">
          {{ posting?.companyName }}<span v-if="posting?.teamName"> · {{ posting.teamName }}</span>
        </p>
      </div>
      <nav class="flex gap-2 overflow-x-auto pb-2" :aria-label="copy('overline')">
        <Button
          v-for="item in areas"
          :key="item"
          as-child
          size="sm"
          :variant="item === props.area ? 'default' : 'outline'"
          ><RouterLink :to="`/jobs/${postId}/${item}`">{{ copy(item) }}</RouterLink></Button
        >
      </nav>
    </header>

    <div v-if="props.area === 'overview'" class="grid gap-5 lg:grid-cols-3">
      <Card class="lg:col-span-2"
        ><CardHeader
          ><CardTitle class="flex items-center gap-2"
            ><Building2 />{{ posting?.companyName }}</CardTitle
          ></CardHeader
        ><CardContent class="grid gap-3"
          ><p>{{ posting?.title }}</p>
          <div class="flex gap-2">
            <Badge>v{{ posting?.versionNumber ?? "-" }}</Badge
            ><Badge variant="outline">{{ posting?.teamName ?? "-" }}</Badge>
          </div></CardContent
        ></Card
      >
      <Card
        ><CardHeader
          ><CardTitle class="flex items-center gap-2"
            ><Users />{{ copy("application") }}</CardTitle
          ></CardHeader
        ><CardContent
          ><p v-if="!application" class="text-sm text-muted-foreground">
            {{ copy("noApplication") }}
          </p>
          <div v-else>
            <p class="text-sm text-muted-foreground">{{ copy("currentStage") }}</p>
            <p class="mt-2 font-semibold">{{ application.stageName }}</p>
          </div></CardContent
        ></Card
      >
      <Card class="lg:col-span-3"
        ><CardHeader
          ><CardTitle class="flex items-center gap-2"
            ><CalendarClock />{{ copy("upcoming") }}</CardTitle
          ></CardHeader
        ><CardContent
          ><p v-if="interviews.length === 0" class="text-sm text-muted-foreground">
            {{ copy("noInterview") }}
          </p>
          <div v-else class="grid gap-2">
            <p v-for="interview in interviews" :key="interview.id" class="rounded border p-3">
              {{ interview.kind }} ·
              {{ new Date(interview.scheduledAt).toLocaleString(settings.locale) }}
            </p>
          </div></CardContent
        ></Card
      >
      <Card class="lg:col-span-3 overflow-hidden">
        <CardHeader class="bg-foreground text-background">
          <CardTitle class="flex items-center gap-2"><ListTodo />{{ copy("nextActions") }}</CardTitle>
          <p class="text-sm text-background/70">{{ copy("nextActionsHelp") }}</p>
        </CardHeader>
        <CardContent class="grid gap-3 pt-5 md:grid-cols-3">
          <RouterLink
            v-for="item in nextActions"
            :key="item.key"
            :to="item.to"
            class="group flex min-h-20 items-center justify-between rounded-xl border p-4 transition hover:-translate-y-0.5 hover:border-primary"
          >
            <span>
              <Badge :variant="item.done ? 'secondary' : 'outline'">{{
                item.done ? copy("done") : copy("recommended")
              }}</Badge>
              <strong class="mt-2 block">{{ copy("next." + item.key) }}</strong>
            </span>
            <ArrowRight class="transition group-hover:translate-x-1" />
          </RouterLink>
        </CardContent>
      </Card>
      <WorkspaceChat
        v-if="application && posting?.currentVersionId"
        :application-id="application.id"
        :job-post-id="postId"
        :posting-title="posting.title"
        :posting-version-id="posting.currentVersionId"
      />
    </div>
    <ResearchView
      v-else-if="props.area === 'company'"
      embedded
      subject-type-preset="company"
      :subject-name-preset="posting?.companyName ?? ''"
      :organization-preset="posting?.companyName ?? ''"
    />
    <ResearchView
      v-else-if="props.area === 'people'"
      embedded
      subject-type-preset="team_lead"
      :organization-preset="posting?.companyName ?? ''"
    />
    <PreparationView v-else-if="workflow" embedded :workflow-preset="workflow" />
  </div>
</template>
