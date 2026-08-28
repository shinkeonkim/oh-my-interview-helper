<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { BriefcaseBusiness, FileText, ListChecks, Workflow } from "lucide-vue-next"
import { toast } from "vue-sonner"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { translate } from "../locales"
import { useSettingsStore } from "../stores/settings"

type Application = { id: string; stageName: string }
type Document = { id: string; state: string }
type Job = {
  id: string
  kind: string
  state: "queued" | "leased" | "running" | "succeeded" | "failed" | "cancelled"
  updatedAt: string
}

const settings = useSettingsStore()
const copy = (key: string) => translate(settings.locale, `statistics.${key}`)
const controller = new AbortController()
const postingCount = ref(0)
const applications = ref<Application[]>([])
const documents = ref<Document[]>([])
const jobs = ref<Job[]>([])
const stageCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const application of applications.value)
    counts.set(application.stageName, (counts.get(application.stageName) ?? 0) + 1)
  return [...counts.entries()].sort((left, right) => right[1] - left[1])
})
const jobCounts = computed(() => {
  const states = ["queued", "leased", "running", "succeeded", "failed", "cancelled"] as const
  return states.map(
    (state) => [state, jobs.value.filter((job) => job.state === state).length] as const
  )
})
const activeDocuments = computed(
  () => documents.value.filter((document) => document.state === "active").length
)
const maximumStageCount = computed(() => Math.max(1, ...stageCounts.value.map((entry) => entry[1])))
const recentJobs = computed(() =>
  [...jobs.value]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 5)
)
const load = async () => {
  const [postingsResponse, applicationsResponse, documentsResponse, jobsResponse] =
    await Promise.all([
      fetch("/api/postings", { signal: controller.signal }),
      fetch("/api/applications", { signal: controller.signal }),
      fetch("/api/documents", { signal: controller.signal }),
      fetch("/api/jobs", { signal: controller.signal })
    ])
  if (
    ![postingsResponse, applicationsResponse, documentsResponse, jobsResponse].every(
      (item) => item.ok
    )
  )
    throw new Error("request")
  postingCount.value = ((await postingsResponse.json()) as { postings: unknown[] }).postings.length
  applications.value = (
    (await applicationsResponse.json()) as { applications: Application[] }
  ).applications
  documents.value = ((await documentsResponse.json()) as { documents: Document[] }).documents
  jobs.value = (await jobsResponse.json()) as Job[]
}
onMounted(() => void load().catch(() => toast.error(copy("failed"))))
onBeforeUnmount(() => controller.abort())
</script>

<template>
  <div class="grid gap-8">
    <section>
      <p class="eyebrow">{{ copy("overline") }}</p>
      <h1 class="page-title mt-4">{{ copy("title") }}</h1>
      <p class="route-copy mt-4">{{ copy("copy") }}</p>
    </section>

    <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" :aria-label="copy('summary')">
      <Card
        ><CardHeader
          ><CardTitle class="flex items-center gap-2 text-base"
            ><BriefcaseBusiness />{{ copy("postings") }}</CardTitle
          ></CardHeader
        ><CardContent
          ><p class="text-3xl font-semibold">{{ postingCount }}</p></CardContent
        ></Card
      >
      <Card
        ><CardHeader
          ><CardTitle class="flex items-center gap-2 text-base"
            ><ListChecks />{{ copy("applications") }}</CardTitle
          ></CardHeader
        ><CardContent
          ><p class="text-3xl font-semibold">{{ applications.length }}</p></CardContent
        ></Card
      >
      <Card
        ><CardHeader
          ><CardTitle class="flex items-center gap-2 text-base"
            ><FileText />{{ copy("documents") }}</CardTitle
          ></CardHeader
        ><CardContent
          ><p class="text-3xl font-semibold">{{ activeDocuments }}</p></CardContent
        ></Card
      >
      <Card
        ><CardHeader
          ><CardTitle class="flex items-center gap-2 text-base"
            ><Workflow />{{ copy("jobs") }}</CardTitle
          ></CardHeader
        ><CardContent
          ><p class="text-3xl font-semibold">{{ jobs.length }}</p></CardContent
        ></Card
      >
    </section>

    <section class="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader
          ><CardTitle>{{ copy("pipeline") }}</CardTitle></CardHeader
        >
        <CardContent>
          <p v-if="stageCounts.length === 0" class="text-sm text-muted-foreground">
            {{ copy("noApplications") }}
          </p>
          <ul v-else class="grid gap-4">
            <li v-for="[stage, count] in stageCounts" :key="stage" class="grid gap-2">
              <div class="flex justify-between text-sm">
                <span>{{ stage }}</span
                ><span>{{ count }}</span>
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  class="h-full rounded-full bg-primary"
                  :style="{ width: `${(count / maximumStageCount) * 100}%` }"
                />
              </div>
            </li>
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader
          ><CardTitle>{{ copy("jobStates") }}</CardTitle></CardHeader
        >
        <CardContent class="flex flex-wrap gap-2">
          <Badge
            v-for="[state, count] in jobCounts"
            :key="state"
            :variant="count ? 'secondary' : 'outline'"
            >{{ copy(`state.${state}`) }} · {{ count }}</Badge
          >
        </CardContent>
      </Card>
      <Card class="lg:col-span-2">
        <CardHeader
          ><CardTitle>{{ copy("recentJobs") }}</CardTitle></CardHeader
        >
        <CardContent>
          <p v-if="recentJobs.length === 0" class="text-sm text-muted-foreground">
            {{ copy("noJobs") }}
          </p>
          <ul v-else class="divide-y">
            <li
              v-for="job in recentJobs"
              :key="job.id"
              class="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
            >
              <span class="font-medium">{{ job.kind }}</span>
              <span class="flex items-center gap-2"
                ><Badge variant="outline">{{ copy(`state.${job.state}`) }}</Badge
                ><time :datetime="job.updatedAt">{{
                  new Date(job.updatedAt).toLocaleString(settings.locale)
                }}</time></span
              >
            </li>
          </ul>
        </CardContent>
      </Card>
    </section>
  </div>
</template>
