<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { RouterLink } from "vue-router"
import {
  BriefcaseBusiness,
  ChevronDown,
  ChevronUp,
  FileText,
  Gauge,
  ListChecks,
  MessageSquareText,
  Play,
  RefreshCw,
  RotateCcw,
  SearchCheck,
  ServerCog,
  Sparkles,
  Workflow,
  X
} from "lucide-vue-next"
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
  payload: Record<string, unknown>
  errorCode: string | null
  errorMessage: string | null
}
type JobEvent = {
  id: string
  sequence: number
  kind: string
  createdAt: string
  payload: Record<string, unknown>
}
type SystemStats = {
  uptime: { since: string; milliseconds: number }
  memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number; externalMb: number }
  counts: Record<string, number>
  providerRuns: {
    total: number
    tokens: { input: number; output: number; cache: number }
    byKind: Array<{ kind: string; count: number; outputTokens: number }>
    states: Array<{ provider: string; status: string; count: number }>
  }
}

const settings = useSettingsStore()
const copy = (key: string) => translate(settings.locale, `statistics.${key}`)
const controller = new AbortController()
const postingCount = ref(0)
const applications = ref<Application[]>([])
const documents = ref<Document[]>([])
const jobs = ref<Job[]>([])
const cancellingJobId = ref<string | null>(null)
const retryingJobId = ref<string | null>(null)
const expandedJobId = ref<string | null>(null)
const jobEvents = ref<JobEvent[]>([])
const systemStats = ref<SystemStats | null>(null)
const eventsLoading = ref(false)
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
    .sort((left, right) => {
      const leftActive = ["queued", "leased", "running"].includes(left.state) ? 1 : 0
      const rightActive = ["queued", "leased", "running"].includes(right.state) ? 1 : 0
      return rightActive - leftActive || Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    })
    .slice(0, 10)
)
const jobLabel = (kind: string) => {
  const labels: Record<string, string> = {
    "ui.research": copy("kind.research"),
    "ui.preparation": copy("kind.preparation"),
    "ui.job_discovery": copy("kind.jobDiscovery"),
    "ui.chat": copy("kind.chat"),
    "provider.invoke": copy("kind.provider")
  }
  return labels[kind] ?? kind
}
const eventLabel = (kind: string) => {
  const known = ["queued", "leased", "running", "progress", "succeeded", "failed", "cancelled"]
  return known.includes(kind) ? copy(`event.${kind}`) : kind
}
const failureLabel = (code: string | null, message: string | null = null) =>
  code === "handler_missing"
    ? copy("error.handlerMissingResolved")
    : (code ?? message ?? copy("unknownFailure"))
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
const retryJob = async (job: Job) => {
  retryingJobId.value = job.id
  try {
    const response = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": await csrf() },
      body: JSON.stringify({
        kind: job.kind,
        input: job.payload,
        idempotencyKey: crypto.randomUUID()
      })
    })
    if (!response.ok) throw new Error("request")
    const retried = (await response.json()) as Job
    jobs.value = [...jobs.value, retried]
    toast.success(copy("retried"))
  } catch {
    toast.error(copy("retryFailed"))
  } finally {
    retryingJobId.value = null
  }
}
const resultRoute = (job: Job) =>
  job.kind === "ui.research"
    ? "/research"
    : job.kind === "ui.job_discovery"
      ? "/job-search"
      : job.kind === "ui.preparation" || job.kind === "ui.chat"
        ? "/jobs"
        : null
const canRetry = (job: Job) =>
  ["failed", "cancelled"].includes(job.state) &&
  ["ui.research", "ui.job_discovery"].includes(job.kind)
const toggleEvents = async (job: Job) => {
  if (expandedJobId.value === job.id) {
    expandedJobId.value = null
    jobEvents.value = []
    return
  }
  expandedJobId.value = job.id
  jobEvents.value = []
  eventsLoading.value = true
  try {
    const response = await fetch(`/api/jobs/${job.id}/events?transport=poll`, {
      signal: controller.signal
    })
    if (!response.ok) throw new Error("request")
    const body = (await response.json()) as { events?: unknown }
    if (!Array.isArray(body.events)) throw new Error("response")
    if (expandedJobId.value === job.id) jobEvents.value = body.events as JobEvent[]
  } catch {
    if (!controller.signal.aborted) toast.error(copy("eventsFailed"))
  } finally {
    eventsLoading.value = false
  }
}
const load = async () => {
  const [postingsResponse, applicationsResponse, documentsResponse, jobsResponse, statsResponse] =
    await Promise.all([
      fetch("/api/postings", { signal: controller.signal }),
      fetch("/api/applications", { signal: controller.signal }),
      fetch("/api/documents", { signal: controller.signal }),
      fetch("/api/jobs", { signal: controller.signal }),
      fetch("/api/stats/overview", { signal: controller.signal })
    ])
  if (
    ![postingsResponse, applicationsResponse, documentsResponse, jobsResponse, statsResponse].every(
      (item) => item.ok
    )
  )
    throw new Error("request")
  const postingsBody = (await postingsResponse.json()) as { postings?: unknown }
  const applicationsBody = (await applicationsResponse.json()) as { applications?: unknown }
  const documentsBody = (await documentsResponse.json()) as { documents?: unknown }
  const jobsBody = await jobsResponse.json()
  const statsBody = (await statsResponse.json()) as SystemStats
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
  systemStats.value = statsBody
}
const uptime = computed(() => {
  const milliseconds = systemStats.value?.uptime.milliseconds ?? 0
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  return `${hours}h ${minutes}m`
})
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
      <Card
        v-if="systemStats"
        class="overflow-hidden border-0 bg-foreground text-background lg:col-span-2"
      >
        <CardHeader>
          <CardTitle class="flex items-center gap-2"
            ><ServerCog />{{ copy("systemHealth") }}</CardTitle
          >
        </CardHeader>
        <CardContent class="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p class="text-xs uppercase tracking-widest text-background/60">{{ copy("uptime") }}</p>
            <p class="mt-2 text-3xl font-semibold">{{ uptime }}</p>
          </div>
          <div>
            <p class="text-xs uppercase tracking-widest text-background/60">RSS</p>
            <p class="mt-2 text-3xl font-semibold">{{ systemStats.memory.rssMb }} MB</p>
          </div>
          <div>
            <p class="text-xs uppercase tracking-widest text-background/60">Heap</p>
            <p class="mt-2 text-3xl font-semibold">{{ systemStats.memory.heapUsedMb }} MB</p>
            <p class="text-xs text-background/60">/ {{ systemStats.memory.heapTotalMb }} MB</p>
          </div>
          <div>
            <p class="text-xs uppercase tracking-widest text-background/60">
              {{ copy("agentRuns") }}
            </p>
            <p class="mt-2 text-3xl font-semibold">{{ systemStats.providerRuns.total }}</p>
          </div>
        </CardContent>
      </Card>
      <Card v-if="systemStats">
        <CardHeader
          ><CardTitle class="flex items-center gap-2"
            ><Gauge />{{ copy("tokens") }}</CardTitle
          ></CardHeader
        >
        <CardContent class="grid grid-cols-3 gap-3 text-center">
          <div class="rounded-xl bg-muted p-3">
            <p class="text-2xl font-semibold">
              {{ systemStats.providerRuns.tokens.input.toLocaleString() }}
            </p>
            <p class="text-xs text-muted-foreground">Input</p>
          </div>
          <div class="rounded-xl bg-muted p-3">
            <p class="text-2xl font-semibold">
              {{ systemStats.providerRuns.tokens.output.toLocaleString() }}
            </p>
            <p class="text-xs text-muted-foreground">Output</p>
          </div>
          <div class="rounded-xl bg-muted p-3">
            <p class="text-2xl font-semibold">
              {{ systemStats.providerRuns.tokens.cache.toLocaleString() }}
            </p>
            <p class="text-xs text-muted-foreground">Cache</p>
          </div>
        </CardContent>
      </Card>
      <Card v-if="systemStats">
        <CardHeader
          ><CardTitle class="flex items-center gap-2"
            ><Sparkles />{{ copy("outputs") }}</CardTitle
          ></CardHeader
        >
        <CardContent class="grid gap-3">
          <div
            v-for="item in systemStats.providerRuns.byKind"
            :key="item.kind"
            class="flex items-center justify-between rounded-lg border p-3 text-sm"
          >
            <span>{{ item.kind }}</span
            ><Badge variant="secondary"
              >{{ item.count }} · {{ item.outputTokens.toLocaleString() }} tok</Badge
            >
          </div>
        </CardContent>
      </Card>
      <Card v-if="systemStats" class="lg:col-span-2">
        <CardHeader
          ><CardTitle>{{ copy("activity") }}</CardTitle></CardHeader
        >
        <CardContent class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div class="rounded-xl border p-4">
            <SearchCheck class="text-primary" />
            <p class="mt-3 text-2xl font-semibold">{{ systemStats.counts["research"] ?? 0 }}</p>
            <p class="text-sm text-muted-foreground">{{ copy("researchRecords") }}</p>
          </div>
          <div class="rounded-xl border p-4">
            <MessageSquareText class="text-primary" />
            <p class="mt-3 text-2xl font-semibold">{{ systemStats.counts["messages"] ?? 0 }}</p>
            <p class="text-sm text-muted-foreground">{{ copy("messages") }}</p>
          </div>
          <div class="rounded-xl border p-4">
            <FileText class="text-primary" />
            <p class="mt-3 text-2xl font-semibold">{{ systemStats.counts["artifacts"] ?? 0 }}</p>
            <p class="text-sm text-muted-foreground">{{ copy("artifacts") }}</p>
          </div>
          <div class="rounded-xl border p-4">
            <BriefcaseBusiness class="text-primary" />
            <p class="mt-3 text-2xl font-semibold">{{ systemStats.counts["interviews"] ?? 0 }}</p>
            <p class="text-sm text-muted-foreground">{{ copy("interviews") }}</p>
          </div>
        </CardContent>
      </Card>
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
            <li v-for="job in recentJobs" :key="job.id" class="grid gap-3 py-3 text-sm">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="font-medium">{{ jobLabel(job.kind) }}</span>
                <span class="flex flex-wrap items-center justify-end gap-2"
                  ><Badge variant="outline">{{ copy(`state.${job.state}`) }}</Badge
                  ><time :datetime="job.updatedAt">{{
                    new Date(job.updatedAt).toLocaleString(settings.locale)
                  }}</time
                  ><Button
                    size="sm"
                    variant="ghost"
                    :aria-expanded="expandedJobId === job.id"
                    @click="toggleEvents(job)"
                    ><ChevronUp v-if="expandedJobId === job.id" /><ChevronDown v-else />{{
                      copy("events")
                    }}</Button
                  ><Button
                    v-if="canRetry(job)"
                    size="sm"
                    variant="outline"
                    :disabled="retryingJobId === job.id"
                    @click="retryJob(job)"
                    ><RotateCcw />{{ copy("retry") }}</Button
                  ><Button
                    v-if="job.state === 'succeeded' && resultRoute(job)"
                    as-child
                    size="sm"
                    variant="outline"
                    ><RouterLink :to="resultRoute(job)!"
                      ><Play />{{ copy("openResult") }}</RouterLink
                    ></Button
                  ><Button
                    v-if="['queued', 'leased', 'running'].includes(job.state)"
                    size="sm"
                    variant="outline"
                    :disabled="cancellingJobId === job.id"
                    @click="cancelJob(job)"
                    ><X />{{ copy("cancel") }}</Button
                  ></span
                >
              </div>
              <p
                v-if="job.state === 'failed'"
                class="rounded-lg bg-destructive/10 p-3 text-destructive"
              >
                {{ copy("failureReason") }} · {{ failureLabel(job.errorCode, job.errorMessage) }}
              </p>
              <div
                v-if="expandedJobId === job.id"
                class="rounded-lg border bg-muted/30 p-3"
                :aria-label="copy('eventHistory')"
              >
                <p v-if="eventsLoading" class="text-muted-foreground">{{ copy("loading") }}</p>
                <p v-else-if="jobEvents.length === 0" class="text-muted-foreground">
                  {{ copy("noEvents") }}
                </p>
                <ol v-else class="grid gap-2">
                  <li
                    v-for="event in jobEvents"
                    :key="event.id"
                    class="flex flex-wrap items-center justify-between gap-2"
                  >
                    <span
                      >#{{ event.sequence }} · {{ eventLabel(event.kind)
                      }}<span v-if="typeof event.payload['code'] === 'string'">
                        · {{ failureLabel(event.payload["code"]) }}</span
                      ></span
                    >
                    <time :datetime="event.createdAt">{{
                      new Date(event.createdAt).toLocaleString(settings.locale)
                    }}</time>
                  </li>
                </ol>
              </div>
            </li>
          </ul>
        </CardContent>
      </Card>
    </section>
  </div>
</template>
