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
  sources: Array<{ id: string; url: string; title: string; excerpt: string; status: string }>
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
const running = ref(false)
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
const sourceUrls = () =>
  urls.value
    .split("\n")
    .map((url) => url.trim())
    .filter(Boolean)
    .slice(0, 8)
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
  if (running.value) return
  const operationContext = contextId
  running.value = true
  try {
    const path =
      parentRecordId === null ? "/api/research" : `/api/research/${parentRecordId}/refresh`
    const body =
      parentRecordId === null
        ? {
            subjectType: subjectType.value,
            subjectName: subjectName.value,
            organization: organization.value || null,
            roleHint: roleHint.value || null,
            jobPostId: jobPostId.value,
            sourceUrls: sourceUrls(),
            parentRecordId: null
          }
        : { sourceUrls: sourceUrls() }
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": await csrf() },
      body: JSON.stringify(body)
    })
    if (!response.ok) throw new Error("research")
    const value = (await response.json()) as ResearchRecord
    if (operationContext !== contextId) return
    current.value = value
    await load()
  } catch {
    if (operationContext === contextId) toast.error(copy("failed"))
  } finally {
    if (operationContext === contextId) running.value = false
  }
}
const openRecord = async (id: string) => {
  const requestId = ++recordRequestId
  const operationContext = contextId
  try {
    const response = await fetch(`/api/research/${id}`)
    if (!response.ok) throw new Error("request")
    const value = (await response.json()) as ResearchRecord
    if (requestId === recordRequestId && operationContext === contextId) current.value = value
  } catch {
    if (requestId === recordRequestId && operationContext === contextId) toast.error(copy("failed"))
  }
}
const identityLabel = (status: ResearchRecord["identityStatus"]) =>
  copy(status === "not_found" ? "notFound" : status)
watch(
  () => [jobPostId.value, props.subjectTypePreset] as const,
  () => {
    contextId += 1
    loadRequestId += 1
    recordRequestId += 1
    records.value = []
    current.value = null
    running.value = false
    subjectType.value = props.subjectTypePreset
    if (props.embedded) {
      subjectName.value = props.subjectNamePreset
      organization.value = props.organizationPreset
      roleHint.value = ""
      urls.value = ""
    }
    void load().catch(() => toast.error(copy("failed")))
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
            <Label>{{ copy("subjectType") }}</Label
            ><Select v-model="subjectType"
              ><SelectTrigger><SelectValue /></SelectTrigger
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
            <Label>{{ copy("subjectName") }}</Label
            ><Input v-model="subjectName" />
          </div>
          <div class="grid gap-2">
            <Label>{{ copy("organization") }}</Label
            ><Input v-model="organization" />
          </div>
          <div class="grid gap-2">
            <Label>{{ copy("roleHint") }}</Label
            ><Input v-model="roleHint" />
          </div>
        </div>
        <div class="grid gap-2">
          <Label>{{ copy("sourceUrls") }}</Label
          ><textarea
            v-model="urls"
            class="min-h-28 rounded-lg border bg-background p-3"
            placeholder="https://company.example/about&#10;https://professional.example/profile"
          />
          <p class="text-sm text-muted-foreground">{{ copy("sourceHelp") }}</p>
        </div>
        <Button class="w-fit" :disabled="running" @click="submit(null)"
          ><Search />{{ copy("run") }}</Button
        ></CardContent
      ></Card
    >
    <section v-if="current" class="grid gap-5">
      <Card
        ><CardHeader class="flex-row items-center justify-between"
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
                  class="text-xs text-primary underline"
                  >{{ current.sources.find((source) => source.id === sourceId)?.title }}
                  <ExternalLink class="inline size-3"
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
            </p></CardContent
          ></Card
        >
      </div>
      <Card
        ><CardHeader class="flex-row items-center justify-between"
          ><CardTitle>{{ copy("sources") }}</CardTitle
          ><Button variant="outline" :disabled="running" @click="submit(current.id)"
            ><RefreshCw />{{ copy("refresh") }}</Button
          ></CardHeader
        ><CardContent class="grid gap-3"
          ><a
            v-for="source in current.sources"
            :key="source.id"
            :href="source.url"
            target="_blank"
            rel="noreferrer"
            class="rounded-lg border p-4"
            ><div class="flex justify-between gap-3">
              <span class="font-medium">{{ source.title }}</span
              ><Badge :variant="source.status === 'available' ? 'secondary' : 'destructive'">{{
                source.status
              }}</Badge>
            </div>
            <p class="mt-2 line-clamp-2 text-sm text-muted-foreground">{{ source.excerpt }}</p></a
          ></CardContent
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
            class="flex justify-between rounded-lg border p-3 text-left"
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
