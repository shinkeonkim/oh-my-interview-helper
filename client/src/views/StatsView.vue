<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { BriefcaseBusiness, FileText, ListChecks, RefreshCw, Workflow, X } from "lucide-vue-next"
import { toast } from "vue-sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
const cancellingJobId = ref<string | null>(null)
let refreshTimer: ReturnType<typeof setInterval> | null = null
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
const csrf = async () =>
  ((await (await fetch("/api/security/csrf")).json()) as { csrfToken: string }).csrfToken
const parseJobs = async (response: Response): Promise<Job[]> => {
  if (!response.ok) throw new Error("request")
  const body = await response.json()
  if (!Array.isArray(body)) throw new Error("response")
  return body as Job[]
}
const refreshJobs = async (notify = false) => {
  try {
    jobs.value = await parseJobs(await fetch("/api/jobs", { signal: controller.signal }))
  } catch {
    if (notify) toast.error(copy("failed"))
  }
}
const cancelJob = async (job: Job) => {
  cancellingJobId.value = job.id
  try {
    const response = await fetch(`/api/jobs/${job.id}/cancel`, {
      method: "POST",
      headers: { "X-CSRF-Token": await csrf() }
    })
    if (!response.ok) throw new Error("request")
    const updated = (await response.json()) as Job
    jobs.value = jobs.value.map((item) => (item.id === updated.id ? updated : item))
    toast.success(copy("cancelled"))
  } catch {
    toast.error(copy("cancelFailed"))
    await refreshJobs()
  } finally {
    cancellingJobId.value = null
  }
}
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
  const postingsBody = (await postingsResponse.json()) as { postings?: unknown }
  const applicationsBody = (await applicationsResponse.json()) as { applications?: unknown }
  const documentsBody = (await documentsResponse.json()) as { documents?: unknown }
  const jobsBody = await jobsResponse.json()
  if (
    !Array.isArray(postingsBody.postings) ||
    !Array.isArray(applicationsBody.applications) ||
    !Array.isArray(documentsBody.documents) ||
    !Array.isArray(jobsBody)
  )
    throw new Error("response")
  postingCount.value = postingsBody.postings.length
  applications.value = applicationsBody.applications as Application[]
  documents.value = documentsBody.documents as Document[]
  jobs.value = jobsBody as Job[]
}
onMounted(() => {
  void load().catch(() => toast.error(copy("failed")))
  refreshTimer = setInterval(() => void refreshJobs(), 5_000)
})
onBeforeUnmount(() => {
  controller.abort()
  if (refreshTimer !== null) clearInterval(refreshTimer)
})
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
        <CardHeader class="flex-row items-center justify-between gap-4"
          ><CardTitle>{{ copy("recentJobs") }}</CardTitle
          ><Button size="sm" variant="outline" @click="refreshJobs(true)"
            ><RefreshCw />{{ copy("refresh") }}</Button
          ></CardHeader
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
              <span class="flex flex-wrap items-center justify-end gap-2"
                ><Badge variant="outline">{{ copy(`state.${job.state}`) }}</Badge
                ><time :datetime="job.updatedAt">{{
                  new Date(job.updatedAt).toLocaleString(settings.locale)
                }}</time
                ><Button
                  v-if="['queued', 'leased', 'running'].includes(job.state)"
                  size="sm"
                  variant="outline"
                  :disabled="cancellingJobId === job.id"
                  @click="cancelJob(job)"
                  ><X />{{ copy("cancel") }}</Button
                ></span
              >
            </li>
          </ul>
        </CardContent>
      </Card>
    </section>
  </div>
</template>
