<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { useRoute } from "vue-router"
import { ExternalLink, RefreshCw, Search } from "lucide-vue-next"
import { toast } from "vue-sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { translate } from "../locales"
import { useSettingsStore } from "../stores/settings"
import {
  backgroundTaskPhaseLabel,
  resumeBackgroundTask,
  runBackgroundTask
} from "../lib/background-task"

type SubjectType = "company" | "executive" | "team_lead" | "team_member"
const props = withDefaults(
  defineProps<{
    subjectTypePreset?: SubjectType
    subjectNamePreset?: string
    organizationPreset?: string
    embedded?: boolean
  }>(),
  {
    subjectTypePreset: "company",
    subjectNamePreset: "",
    organizationPreset: "",
    embedded: false
  }
)
type RecordSummary = {
  id: string
  subjectType: SubjectType
  subjectName: string
  parentRecordId: string | null
  identityStatus: "confirmed" | "ambiguous" | "not_found"
  createdAt: string
}
type ResearchRecord = RecordSummary & {
  analysis: {
    summary: { career: string[]; stack: string[]; projects: string[] }
    fitAssessment: { label: "advisory"; summary: string; strengths: string[]; risks: string[] }
  }
  identityCandidates: Array<{
    name: string
    role: string | null
    organization: string | null
    sourceIds: string[]
  }>
  claims: Array<{
    id: string
    statement: string
    classification: "fact" | "inference" | "advisory" | "unverified"
    sourceIds: string[]
    confidence: string
  }>
  sources: Array<{
    id: string
    url: string
    title: string
    excerpt: string
    status: string
    retrievedAt: string
  }>
}
const route = useRoute()
const settings = useSettingsStore()
const copy = (key: string) => translate(settings.locale, `research.${key}`)
const subjectType = ref<SubjectType>(props.subjectTypePreset)
const subjectName = ref(props.subjectNamePreset)
const organization = ref(props.organizationPreset)
const roleHint = ref("")
const urls = ref("")
const records = ref<RecordSummary[]>([])
const current = ref<ResearchRecord | null>(null)
const previous = ref<ResearchRecord | null>(null)
const selectedClaimId = ref<string | null>(null)
const running = ref(false)
const taskPhase = ref<string | null>(null)
const taskPhaseCopy = computed(() => backgroundTaskPhaseLabel(taskPhase.value, settings.locale))
const openingRecordId = ref<string | null>(null)
const loadController = new AbortController()
let contextId = 0
let loadRequestId = 0
let recordRequestId = 0
const jobPostId = computed(() => {
  const value = route.params["postId"]
  return typeof value === "string" ? value : null
})
const csrf = async () =>
  ((await (await fetch("/api/security/csrf")).json()) as { csrfToken: string }).csrfToken
const parsedSourceUrls = computed(() => {
  const values = urls.value
    .split("\n")
    .map((url) => url.trim())
    .filter(Boolean)
  if (values.length === 0) return []
  if (values.length > 8) return null
  try {
    const parsed = values.map((value) => new URL(value))
    if (
      parsed.some(
        (url) =>
          (url.protocol !== "http:" && url.protocol !== "https:") ||
          url.username !== "" ||
          url.password !== ""
      )
    )
      return null
    return parsed.map((url) => url.toString())
  } catch {
    return null
  }
})
const researchReady = computed(
  () => subjectName.value.trim().length > 0 && parsedSourceUrls.value !== null
)
const taskScope = computed(
  () => `research:${jobPostId.value ?? "global"}:${props.subjectTypePreset}`
)
const load = async () => {
  const requestId = ++loadRequestId
  const requestedPostId = jobPostId.value
  const query = requestedPostId === null ? "" : `?jobPostId=${encodeURIComponent(requestedPostId)}`
  try {
    const response = await fetch(`/api/research${query}`, { signal: loadController.signal })
    if (!response.ok) throw new Error("request")
    const value = (await response.json()) as { records: RecordSummary[] }
    if (requestId !== loadRequestId || requestedPostId !== jobPostId.value) return
    records.value = value.records
    const latest = value.records[0]
    if (current.value === null && latest !== undefined) void openRecord(latest.id)
  } catch (error) {
    if (requestId === loadRequestId) throw error
  }
}
watch(
  () => [props.subjectNamePreset, props.organizationPreset] as const,
  ([name, company]) => {
    if (subjectName.value === "") subjectName.value = name
    if (organization.value === "") organization.value = company
  }
)
const submit = async (parentRecordId: string | null = null) => {
  if (
    running.value ||
    parsedSourceUrls.value === null ||
    (parentRecordId === null && !researchReady.value)
  )
    return
  const operationContext = contextId
  const selectedSourceUrls = parsedSourceUrls.value
  running.value = true
  try {
    const body =
      parentRecordId === null
        ? {
            subjectType: subjectType.value,
            subjectName: subjectName.value,
            organization: organization.value || null,
            roleHint: roleHint.value || null,
            jobPostId: jobPostId.value,
            sourceUrls: selectedSourceUrls,
            parentRecordId: null
          }
        : { sourceUrls: selectedSourceUrls }
    const result = await runBackgroundTask(
      "ui.research",
      {
        action: parentRecordId === null ? "create" : "refresh",
        recordId: parentRecordId,
        request: body
      },
      await csrf(),
      (_state, phase) => (taskPhase.value = phase),
      loadController.signal,
      taskScope.value
    )
    if (operationContext !== contextId) return
    await load()
    if (typeof result["recordId"] === "string") await openRecord(result["recordId"])
  } catch {
    if (operationContext === contextId) toast.error(copy("failed"))
  } finally {
    if (operationContext === contextId) {
      running.value = false
      taskPhase.value = null
    }
  }
}
const resumeTask = () => {
  const operationContext = contextId
  const resumed = resumeBackgroundTask(
    taskScope.value,
    (_state, phase) => {
      if (operationContext === contextId) {
        running.value = true
        taskPhase.value = phase
      }
    },
    loadController.signal
  )
  if (resumed !== null)
    void resumed
      .then(async (result) => {
        if (operationContext !== contextId) return
        await load()
        if (typeof result["recordId"] === "string") await openRecord(result["recordId"])
      })
      .catch(() => operationContext === contextId && toast.error(copy("failed")))
      .finally(() => {
        if (operationContext === contextId) {
          running.value = false
          taskPhase.value = null
        }
      })
}
const openRecord = async (id: string) => {
  const requestId = ++recordRequestId
  const operationContext = contextId
  openingRecordId.value = id
  try {
    const response = await fetch(`/api/research/${id}`)
    if (!response.ok) throw new Error("request")
    const value = (await response.json()) as ResearchRecord
    let parent: ResearchRecord | null = null
    if (value.parentRecordId !== null) {
      const parentResponse = await fetch(`/api/research/${value.parentRecordId}`)
      if (parentResponse.ok) parent = (await parentResponse.json()) as ResearchRecord
    }
    if (requestId === recordRequestId && operationContext === contextId) {
      current.value = value
      previous.value = parent
      selectedClaimId.value = null
    }
  } catch {
    if (requestId === recordRequestId && operationContext === contextId) toast.error(copy("failed"))
  } finally {
    if (requestId === recordRequestId && operationContext === contextId)
      openingRecordId.value = null
  }
}
const identityLabel = (status: ResearchRecord["identityStatus"]) =>
  copy(status === "not_found" ? "notFound" : status)
const selectedSourceIds = computed(
  () => current.value?.claims.find((claim) => claim.id === selectedClaimId.value)?.sourceIds ?? []
)
const sourceCategory = (url: string) => {
  const host = new URL(url).hostname.toLocaleLowerCase()
  if (/career|jobs|wanted|jobplanet|linkedin/.test(host)) return "hiring"
  if (/news|techcrunch|thevc|venturesquare|rocketpunch|inno/.test(host)) return "media"
  if (/github|medium|blog/.test(host)) return "technical"
  return "website"
}
const staleSource = (retrievedAt: string) =>
  Date.now() - Date.parse(retrievedAt) > 30 * 24 * 60 * 60 * 1_000
const claimDiff = computed(() => {
  if (current.value === null || previous.value === null) return null
  const before = new Set(previous.value.claims.map((claim) => claim.statement))
  const after = new Set(current.value.claims.map((claim) => claim.statement))
  return {
    added: [...after].filter((statement) => !before.has(statement)).length,
    removed: [...before].filter((statement) => !after.has(statement)).length
  }
})
const focusSource = (sourceId: string, claimId: string) => {
  selectedClaimId.value = claimId
  document.getElementById(`research-source-${sourceId}`)?.scrollIntoView({
    behavior: "smooth",
    block: "center"
  })
}
watch(
  () => [jobPostId.value, props.subjectTypePreset] as const,
  () => {
    contextId += 1
    loadRequestId += 1
    recordRequestId += 1
    records.value = []
    current.value = null
    previous.value = null
    selectedClaimId.value = null
    running.value = false
    openingRecordId.value = null
    subjectType.value = props.subjectTypePreset
    if (props.embedded) {
      subjectName.value = props.subjectNamePreset
      organization.value = props.organizationPreset
      roleHint.value = ""
      urls.value = ""
    }
    void load()
      .then(resumeTask)
      .catch(() => toast.error(copy("failed")))
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  contextId += 1
  loadRequestId += 1
  recordRequestId += 1
  loadController.abort()
})
</script>

<template>
  <div class="grid gap-8">
    <section v-if="!props.embedded">
      <p class="eyebrow">{{ copy("overline") }}</p>
      <h1 class="page-title mt-4">{{ copy("title") }}</h1>
      <p class="route-copy mt-4">{{ copy("copy") }}</p>
    </section>
    <Card
      ><CardContent class="grid gap-4 py-6"
        ><div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div class="grid gap-2">
            <Label for="research-subject-type">{{ copy("subjectType") }}</Label
            ><Select v-model="subjectType" :disabled="running"
              ><SelectTrigger id="research-subject-type"><SelectValue /></SelectTrigger
              ><SelectContent
                ><SelectItem value="company">{{ copy("company") }}</SelectItem
                ><SelectItem value="executive">{{ copy("executive") }}</SelectItem
                ><SelectItem value="team_lead">{{ copy("teamLead") }}</SelectItem
                ><SelectItem value="team_member">{{
                  copy("teamMember")
                }}</SelectItem></SelectContent
              ></Select
            >
          </div>
          <div class="grid gap-2">
            <Label for="research-subject-name">{{ copy("subjectName") }}</Label
            ><Input id="research-subject-name" v-model="subjectName" :disabled="running" />
          </div>
          <div class="grid gap-2">
            <Label for="research-organization">{{ copy("organization") }}</Label
            ><Input id="research-organization" v-model="organization" :disabled="running" />
          </div>
          <div class="grid gap-2">
            <Label for="research-role-hint">{{ copy("roleHint") }}</Label
            ><Input id="research-role-hint" v-model="roleHint" :disabled="running" />
          </div>
        </div>
        <div class="grid gap-2">
          <Label for="research-source-urls">{{ copy("sourceUrls") }}</Label
          ><textarea
            id="research-source-urls"
            v-model="urls"
            class="min-h-28 rounded-lg border bg-background p-3"
            :disabled="running"
            placeholder="https://company.example/about&#10;https://professional.example/profile"
          />
          <p class="text-sm text-muted-foreground">{{ copy("sourceHelp") }}</p>
        </div>
        <Button class="w-fit" :disabled="running || !researchReady" @click="submit(null)"
          ><Search />{{ copy("run") }}</Button
        >
        <p
          v-if="running"
          class="flex items-center gap-3 text-sm text-muted-foreground"
          role="status"
        >
          <span class="size-2 animate-pulse rounded-full bg-primary" />
          {{ copy("backgroundRunning") }}<span v-if="taskPhaseCopy"> · {{ taskPhaseCopy }}</span>
        </p></CardContent
      ></Card
    >
    <section v-if="current" class="grid gap-5">
      <Card
        ><CardHeader class="flex-col items-start justify-between gap-3 sm:flex-row sm:items-center"
          ><CardTitle>{{ current.subjectName }}</CardTitle
          ><Badge>{{ identityLabel(current.identityStatus) }}</Badge></CardHeader
        ><CardContent
          ><div v-if="current.identityCandidates.length" class="grid gap-2">
            <p
              v-for="candidate in current.identityCandidates"
              :key="candidate.name + candidate.role"
            >
              {{ candidate.name }}<span v-if="candidate.role"> · {{ candidate.role }}</span
              ><span v-if="candidate.organization"> · {{ candidate.organization }}</span>
            </p>
          </div></CardContent
        ></Card
      >
      <div class="grid gap-5 md:grid-cols-3">
        <Card v-for="section in ['career', 'stack', 'projects'] as const" :key="section">
          <CardHeader
            ><CardTitle>{{ copy(section) }}</CardTitle></CardHeader
          >
          <CardContent>
            <p
              v-if="current.analysis.summary[section].length === 0"
              class="text-sm text-muted-foreground"
            >
              {{ copy("noEvidence") }}
            </p>
            <ul v-else class="grid list-disc gap-2 pl-5 text-sm leading-6">
              <li v-for="item in current.analysis.summary[section]" :key="item">{{ item }}</li>
            </ul>
          </CardContent>
        </Card>
      </div>
      <Card v-if="claimDiff">
        <CardHeader
          ><CardTitle>{{ copy("changes") }}</CardTitle></CardHeader
        >
        <CardContent class="flex flex-wrap gap-3 text-sm">
          <Badge variant="secondary">+ {{ claimDiff.added }} {{ copy("addedClaims") }}</Badge>
          <Badge variant="outline">- {{ claimDiff.removed }} {{ copy("removedClaims") }}</Badge>
          <span class="text-muted-foreground">{{ copy("changesHelp") }}</span>
        </CardContent>
      </Card>
      <div class="grid gap-5 lg:grid-cols-2">
        <Card
          ><CardHeader
            ><CardTitle>{{ copy("claims") }}</CardTitle></CardHeader
          ><CardContent class="grid gap-3"
            ><article v-for="claim in current.claims" :key="claim.id" class="rounded-lg border p-4">
              <div class="flex gap-2">
                <Badge variant="outline">{{ copy(claim.classification) }}</Badge
                ><Badge variant="secondary">{{ claim.confidence }}</Badge>
              </div>
              <p class="mt-3 text-sm leading-6">{{ claim.statement }}</p>
              <div class="mt-3 flex flex-wrap gap-2">
                <a
                  v-for="sourceId in claim.sourceIds"
                  :key="sourceId"
                  :href="current.sources.find((source) => source.id === sourceId)?.url"
                  target="_blank"
                  rel="noreferrer"
                  class="text-left text-xs text-primary underline"
                  @click="focusSource(sourceId, claim.id)"
                  >{{ current.sources.find((source) => source.id === sourceId)?.title
                  }}<ExternalLink class="inline size-3"
                /></a>
              </div></article></CardContent></Card
        ><Card
          ><CardHeader
            ><CardTitle>{{ copy("fit") }}</CardTitle></CardHeader
          ><CardContent
            ><Badge>{{ copy("advisory") }}</Badge>
            <p class="mt-3 text-sm font-medium">{{ copy("advisoryNotice") }}</p>
            <p class="mt-3 text-sm leading-6 text-muted-foreground">
              {{ current.analysis.fitAssessment.summary }}
            </p>
            <div v-if="current.analysis.fitAssessment.strengths.length" class="mt-4">
              <p class="text-sm font-medium">{{ copy("strengths") }}</p>
              <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                <li v-for="item in current.analysis.fitAssessment.strengths" :key="item">
                  {{ item }}
                </li>
              </ul>
            </div>
            <div v-if="current.analysis.fitAssessment.risks.length" class="mt-4">
              <p class="text-sm font-medium">{{ copy("risks") }}</p>
              <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                <li v-for="item in current.analysis.fitAssessment.risks" :key="item">
                  {{ item }}
                </li>
              </ul>
            </div></CardContent
          ></Card
        >
      </div>
      <Card
        ><CardHeader class="flex-col items-start justify-between gap-3 sm:flex-row sm:items-center"
          ><CardTitle>{{ copy("sources") }}</CardTitle
          ><Button variant="outline" :disabled="running" @click="submit(current.id)"
            ><RefreshCw />{{ copy("refresh") }}</Button
          ></CardHeader
        ><CardContent class="grid gap-3"
          ><article
            v-for="source in current.sources"
            :key="source.id"
            :id="'research-source-' + source.id"
            class="rounded-lg border p-4 transition"
            :class="
              selectedSourceIds.includes(source.id)
                ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                : ''
            "
          >
            <div class="flex flex-col gap-3 sm:flex-row sm:justify-between">
              <span class="font-medium">{{ source.title }}</span>
              <div class="flex flex-wrap justify-end gap-2">
                <Badge variant="outline">{{
                  copy("sourceType." + sourceCategory(source.url))
                }}</Badge>
                <Badge v-if="staleSource(source.retrievedAt)" variant="destructive">{{
                  copy("staleSource")
                }}</Badge>
                <Badge :variant="source.status === 'available' ? 'secondary' : 'destructive'">{{
                  source.status
                }}</Badge>
              </div>
            </div>
            <p class="mt-2 text-xs text-muted-foreground">
              {{ copy("retrieved") }} ·
              {{ new Date(source.retrievedAt).toLocaleString(settings.locale) }}
            </p>
            <p class="mt-2 line-clamp-3 text-sm text-muted-foreground">{{ source.excerpt }}</p>
            <Button class="mt-3" as-child size="sm" variant="ghost"
              ><a :href="source.url" target="_blank" rel="noreferrer"
                ><ExternalLink />{{ copy("openSource") }}</a
              ></Button
            >
          </article></CardContent
        ></Card
      >
    </section>
    <Card
      ><CardHeader
        ><CardTitle>{{ copy("history") }}</CardTitle></CardHeader
      ><CardContent
        ><p v-if="records.length === 0" class="text-muted-foreground">{{ copy("empty") }}</p>
        <div v-else class="grid gap-2">
          <button
            v-for="record in records"
            :key="record.id"
            class="flex flex-col gap-1 rounded-lg border p-3 text-left sm:flex-row sm:justify-between"
            :disabled="running || openingRecordId === record.id"
            @click="openRecord(record.id)"
          >
            <span>{{ record.subjectName }} · {{ identityLabel(record.identityStatus) }}</span
            ><time :datetime="record.createdAt">{{
              new Date(record.createdAt).toLocaleString(settings.locale)
            }}</time>
          </button>
        </div></CardContent
      ></Card
    >
  </div>
</template>
