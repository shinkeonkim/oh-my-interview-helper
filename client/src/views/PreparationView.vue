<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { useRoute } from "vue-router"
import { Clipboard, Download, RotateCw, ShieldCheck } from "lucide-vue-next"
import { toast } from "vue-sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { translate } from "../locales"
import { useSettingsStore } from "../stores/settings"
import {
  backgroundTaskPhaseLabel,
  resumeBackgroundTask,
  runBackgroundTask
} from "../lib/background-task"

type Workflow =
  | "cover_letter"
  | "resume_feedback"
  | "interview_prep"
  | "technical_prep"
  | "culture_interview"
  | "topic_answers"
  | "company_questions"
type Posting = {
  id: string
  title: string
  companyName: string
  currentVersionId: string | null
  versionNumber: number | null
}
type Document = {
  id: string
  title: string
  state: string
  currentVersionId: string | null
  versionNumber: number | null
}
type Provider = { id: string; model: { id: string; displayName: string }; configured: boolean }
type ResearchSource = { id: string; title: string; url: string; status: string }
type Manifest = {
  destination: string
  model: string
  action: string
  inputs: Array<{ type: string; label: string; version: number | null; hash: string }>
}
type WorkflowRequest = {
  workflow: Workflow
  providerId: string
  seriesId: string | null
  inputs: Array<Record<string, string>>
  practiceAnswer: string | null
  topic: Topic | null
  generationKey: string
}
type Topic = {
  id: string
  label: string
  description: string
  promptHint: string
}
type Revision = {
  id: string
  seriesId: string
  number: number
  content: Record<string, unknown>
  providerId: string
  providerModel: string
}
type Citation = { sourceId: string; note: string }
type ResultSection = { heading: string; body: string; citations: Citation[] }
type ResultQuestion = {
  question: string
  suggestedAnswer: string
  rationale: string
  citations: Citation[]
}
type StaleReason =
  | "source_content_changed"
  | "source_current_version_changed"
  | "source_unavailable"
  | "provider_disabled"
  | "provider_unavailable"
  | "provider_changed"
  | "model_changed"
  | "mode_changed"
  | "prompt_missing"
  | "prompt_changed"
type Provenance = Revision & {
  providerMode: string
  promptTemplateId: string
  promptTemplateRevision: number
  inputs: Array<{ hash: string; label: string; version: number | null }>
  staleReasons: StaleReason[]
}

const props = withDefaults(
  defineProps<{
    workflowPreset?: Workflow
    embedded?: boolean
  }>(),
  { workflowPreset: "cover_letter", embedded: false }
)

const route = useRoute()
const settings = useSettingsStore()
const copy = (key: string) => translate(settings.locale, `preparation.${key}`)
const controller = new AbortController()
const postings = ref<Posting[]>([])
const documents = ref<Document[]>([])
const cultureResearchSources = ref<ResearchSource[]>([])
const providers = ref<Provider[]>([])
const workflow = ref<Workflow>(props.workflowPreset)
const providerId = ref("")
const selectedDocumentVersionIds = ref<string[]>([])
const practiceAnswer = ref("")
const selectedTopicId = ref("self-intro")
const generationKey = ref(crypto.randomUUID())
const preview = ref<{
  manifest: Manifest
  authorizationToken: string
  request: WorkflowRequest
} | null>(null)
const revision = ref<Revision | null>(null)
const resultTitle = computed(() => String(revision.value?.content["title"] ?? copy("result")))
const resultSummary = computed(() => String(revision.value?.content["summary"] ?? ""))
const resultSections = computed(
  () => (revision.value?.content["sections"] ?? []) as ResultSection[]
)
const resultQuestions = computed(
  () => (revision.value?.content["questions"] ?? []) as ResultQuestion[]
)
const evidenceGaps = computed(() =>
  resultSections.value.filter((section) =>
    /gap|risk|missing|weak|부족|위험|보완|누락/i.test(`${section.heading} ${section.body}`)
  )
)
const provenance = ref<Provenance | null>(null)
const reviewing = ref(false)
const running = ref(false)
const taskPhase = ref<string | null>(null)
const taskPhaseCopy = computed(() => backgroundTaskPhaseLabel(taskPhase.value, settings.locale))
let contextId = 0
let loadRequestId = 0
let provenanceRequestId = 0
const postId = computed(() => String(route.params["postId"] ?? ""))
const taskScope = computed(() => `preparation:${postId.value}:${props.workflowPreset}`)
const posting = computed(() => postings.value.find((item) => item.id === postId.value))
const inputs = computed(() => {
  const values: Array<Record<string, string>> = []
  if (posting.value?.currentVersionId)
    values.push({ kind: "job_post_version", jobPostVersionId: posting.value.currentVersionId })
  for (const documentVersionId of selectedDocumentVersionIds.value)
    values.push({ kind: "document_version", documentVersionId })
  if (workflow.value === "culture_interview")
    for (const source of cultureResearchSources.value)
      values.push({ kind: "research_source", researchSourceId: source.id })
  return values
})
const topics: readonly Topic[] = [
  {
    id: "self-intro",
    label: "자기소개",
    description: "경력 요약과 강점을 명확히 전달하는 자기소개",
    promptHint: "30초, 1분, 3분 길이로 만들고 지원 동기와 연결합니다."
  },
  {
    id: "work-experience",
    label: "직무수행 경험",
    description: "대표 프로젝트와 업무 성과 사례",
    promptHint: "실제 경험 2~3건을 STAR 구조와 구체적인 수치로 설명합니다."
  },
  {
    id: "collaboration",
    label: "협업경험",
    description: "팀 협업, 갈등 조정, 의사소통 사례",
    promptHint: "의견 충돌 상황과 합의 과정, 직군 간 협업 사례를 우선합니다."
  },
  {
    id: "work-style",
    label: "업무방식",
    description: "문제 접근 방법, 일하는 리듬, 도구 활용",
    promptHint: "실제로 사용한 방법론과 도구, 반복 가능한 업무 관행을 인용합니다."
  },
  {
    id: "values",
    label: "가치관",
    description: "왜 일하는지, 어떤 일에 시간을 쓰는지",
    promptHint: "추상적인 단어 대신 가치관을 행동으로 보여준 사례를 사용합니다."
  },
  {
    id: "failure-growth",
    label: "실패와 성장",
    description: "실패에서 배운 것과 이후의 변화",
    promptHint: "실패 사실, 즉시 대응, 장기적인 업무 방식 변화를 순서대로 설명합니다."
  },
  {
    id: "tech-decisions",
    label: "기술 선택과 판단",
    description: "기술 도입·포기 의사결정과 트레이드오프",
    promptHint: "대안 비교, 선택 이유, 결과 회고를 근거와 함께 설명합니다."
  },
  {
    id: "why-this-company",
    label: "지원 동기 / 회사 적합도",
    description: "왜 이 회사와 직무에 지원했는지",
    promptHint: "공고, 회사, 기술 스택과 본인 경험이 맞는 지점 세 가지를 연결합니다."
  }
]
const selectedTopic = computed(
  () => topics.find((topic) => topic.id === selectedTopicId.value) ?? topics[0]!
)
const toggleDocument = (versionId: string) => {
  selectedDocumentVersionIds.value = selectedDocumentVersionIds.value.includes(versionId)
    ? selectedDocumentVersionIds.value.filter((id) => id !== versionId)
    : [...selectedDocumentVersionIds.value, versionId]
}
const workflowLabels: Array<[Workflow, string]> = [
  ["cover_letter", "coverLetter"],
  ["resume_feedback", "resumeFeedback"],
  ["interview_prep", "interviewPrep"],
  ["technical_prep", "technicalPrep"],
  ["culture_interview", "cultureInterview"],
  ["topic_answers", "topicAnswers"],
  ["company_questions", "companyQuestions"]
]
const csrf = async () =>
  ((await (await fetch("/api/security/csrf")).json()) as { csrfToken: string }).csrfToken
const post = async (path: string, body: unknown) => {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": await csrf() },
    body: JSON.stringify(body)
  })
  if (!response.ok) throw new Error("request")
  return response
}
const loadCultureResearchSources = async (companyName: string) => {
  if (workflow.value !== "culture_interview") {
    cultureResearchSources.value = []
    return
  }
  const response = await fetch(`/api/research?jobPostId=${encodeURIComponent(postId.value)}`, {
    signal: controller.signal
  })
  if (!response.ok) throw new Error("request")
  const body = (await response.json()) as {
    records: Array<{ id: string; subjectType: string; subjectName: string }>
  }
  const record = body.records.find(
    (item) => item.subjectType === "company" && item.subjectName === companyName
  )
  if (record === undefined) {
    cultureResearchSources.value = []
    return
  }
  const detailResponse = await fetch(`/api/research/${record.id}`, { signal: controller.signal })
  if (!detailResponse.ok) throw new Error("request")
  const detail = (await detailResponse.json()) as { sources: ResearchSource[] }
  cultureResearchSources.value = detail.sources
    .filter((source) => source.status === "available")
    .slice(0, 8)
}
const requestBody = (): WorkflowRequest => ({
  workflow: workflow.value,
  providerId: providerId.value,
  seriesId: revision.value?.seriesId ?? null,
  inputs: inputs.value,
  practiceAnswer: practiceAnswer.value.trim() || null,
  topic: workflow.value === "topic_answers" ? selectedTopic.value : null,
  generationKey: generationKey.value
})
const load = async () => {
  const requestId = ++loadRequestId
  try {
    const [postingsResponse, documentsResponse, providersResponse] = await Promise.all([
      fetch("/api/postings", { signal: controller.signal }),
      fetch("/api/documents", { signal: controller.signal }),
      fetch("/api/providers/status", { signal: controller.signal })
    ])
    if (!postingsResponse.ok || !documentsResponse.ok || !providersResponse.ok)
      throw new Error("request")
    const [postingValue, documentValue, providerValue] = await Promise.all([
      postingsResponse.json() as Promise<{ postings: Posting[] }>,
      documentsResponse.json() as Promise<{ documents: Document[] }>,
      providersResponse.json() as Promise<{ providers: Provider[] }>
    ])
    if (requestId !== loadRequestId) return
    postings.value = postingValue.postings
    documents.value = documentValue.documents.filter(
      (item) => item.state === "active" && item.currentVersionId
    )
    providers.value = providerValue.providers.filter((item) => item.configured)
    providerId.value = providers.value[0]?.id ?? ""
    await loadCultureResearchSources(
      postingValue.postings.find((item) => item.id === postId.value)?.companyName ?? ""
    )
  } catch (error) {
    if (requestId === loadRequestId) throw error
  }
}
const review = async () => {
  if (!posting.value?.currentVersionId || !providerId.value || reviewing.value || running.value)
    return
  const operationContext = contextId
  const request = requestBody()
  reviewing.value = true
  try {
    const value = (await (await post("/api/workflows/preview", request)).json()) as {
      manifest: Manifest
      authorizationToken: string
    }
    if (operationContext === contextId) preview.value = { ...value, request }
  } catch {
    if (operationContext === contextId) toast.error(copy("failed"))
  } finally {
    if (operationContext === contextId) reviewing.value = false
  }
}
const generate = async () => {
  if (!preview.value || running.value) return
  const operationContext = contextId
  const reviewed = preview.value
  running.value = true
  try {
    const confirmation = (await (
      await post("/api/disclosures/confirm", {
        authorizationToken: reviewed.authorizationToken
      })
    ).json()) as { id: string }
    if (operationContext !== contextId) return
    const result = await runBackgroundTask(
      "ui.preparation",
      { request: { ...reviewed.request, disclosureId: confirmation.id } },
      await csrf(),
      (_state, phase) => (taskPhase.value = phase),
      controller.signal,
      taskScope.value
    )
    const value = await revisionFromTaskResult(result)
    if (operationContext !== contextId) return
    revision.value = value
    preview.value = null
    await loadProvenance(value)
  } catch {
    if (operationContext === contextId) toast.error(copy("failed"))
  } finally {
    if (operationContext === contextId) {
      running.value = false
      taskPhase.value = null
      generationKey.value = crypto.randomUUID()
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
    controller.signal
  )
  if (resumed !== null)
    void resumed
      .then(async (result) => {
        if (operationContext !== contextId) return
        revision.value = await revisionFromTaskResult(result)
        preview.value = null
        return loadProvenance(revision.value)
      })
      .catch(() => operationContext === contextId && toast.error(copy("failed")))
      .finally(() => {
        if (operationContext === contextId) {
          running.value = false
          taskPhase.value = null
        }
      })
}
const revisionFromTaskResult = async (result: Record<string, unknown>): Promise<Revision> => {
  if (typeof result["revisionId"] === "string") {
    const response = await fetch(`/api/artifacts/revisions/${result["revisionId"]}`)
    if (!response.ok) throw new Error("revision_unavailable")
    return (await response.json()) as Revision
  }
  return result["revision"] as Revision
}
const copyResult = async () => {
  if (revision.value) {
    await navigator.clipboard.writeText(JSON.stringify(revision.value.content, null, 2))
    toast.success(copy("copied"))
  }
}
const exportResult = () => {
  if (!revision.value) return
  window.open(
    `/api/artifacts/revisions/${revision.value.id}/export`,
    "_blank",
    "noopener,noreferrer"
  )
}
const loadProvenance = async (target: Revision | null = revision.value) => {
  if (target === null) return
  const requestId = ++provenanceRequestId
  const operationContext = contextId
  try {
    const response = await fetch(`/api/artifacts/revisions/${target.id}/provenance`)
    if (!response.ok) throw new Error("request")
    const value = (await response.json()) as Provenance
    if (
      requestId === provenanceRequestId &&
      operationContext === contextId &&
      revision.value?.id === target.id
    )
      provenance.value = value
  } catch {
    if (requestId === provenanceRequestId && operationContext === contextId)
      toast.error(copy("provenanceFailed"))
  }
}
watch(
  () => [postId.value, props.workflowPreset] as const,
  () => {
    contextId += 1
    loadRequestId += 1
    provenanceRequestId += 1
    workflow.value = props.workflowPreset
    providerId.value = ""
    selectedDocumentVersionIds.value = []
    practiceAnswer.value = ""
    selectedTopicId.value = "self-intro"
    generationKey.value = crypto.randomUUID()
    preview.value = null
    revision.value = null
    provenance.value = null
    reviewing.value = false
    running.value = false
    void load()
      .then(resumeTask)
      .catch(() => toast.error(copy("failed")))
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  contextId += 1
  loadRequestId += 1
  provenanceRequestId += 1
  controller.abort()
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
      ><CardHeader
        ><CardTitle>{{ posting?.title ?? copy("title") }}</CardTitle></CardHeader
      ><CardContent class="grid gap-5">
        <p
          v-if="!posting?.currentVersionId || providers.length === 0"
          class="text-sm text-destructive"
        >
          {{ copy("unavailable") }}
        </p>
        <div class="grid gap-4 md:grid-cols-2">
          <div class="grid gap-2">
            <Label for="preparation-workflow">{{ copy("workflow") }}</Label
            ><Select v-model="workflow"
              ><SelectTrigger id="preparation-workflow"><SelectValue /></SelectTrigger
              ><SelectContent
                ><SelectItem v-for="[value, label] in workflowLabels" :key="value" :value="value">{{
                  copy(label)
                }}</SelectItem></SelectContent
              ></Select
            >
          </div>
          <div class="grid gap-2">
            <Label>{{ copy("document") }}</Label>
            <p class="text-sm text-muted-foreground">{{ copy("postingIncluded") }}</p>
            <div class="grid max-h-48 gap-2 overflow-auto rounded-xl border p-3">
              <label
                v-for="document in documents"
                :key="document.id"
                class="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted"
              >
                <input
                  type="checkbox"
                  :checked="selectedDocumentVersionIds.includes(document.currentVersionId!)"
                  @change="toggleDocument(document.currentVersionId!)"
                />
                <span>{{ document.title }} · v{{ document.versionNumber }}</span>
              </label>
              <p v-if="documents.length === 0" class="text-sm text-muted-foreground">
                {{ copy("noDocuments") }}
              </p>
            </div>
          </div>
        </div>
        <div v-if="workflow === 'topic_answers'" class="grid gap-3">
          <Label>{{ copy("topic") }}</Label>
          <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <button
              v-for="topic in topics"
              :key="topic.id"
              type="button"
              class="rounded-xl border p-4 text-left transition-colors"
              :class="
                selectedTopicId === topic.id ? 'border-primary bg-primary/5' : 'hover:bg-muted'
              "
              @click="selectedTopicId = topic.id"
            >
              <span class="font-medium">{{ topic.label }}</span>
              <span class="mt-1 block text-xs leading-5 text-muted-foreground">{{
                topic.description
              }}</span>
            </button>
          </div>
        </div>
        <p class="text-sm text-muted-foreground">{{ copy("automaticAgent") }}</p>
        <div
          v-if="workflow === 'culture_interview'"
          class="rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm"
        >
          <p class="font-medium">{{ copy("cultureEvidence") }}</p>
          <p class="mt-1 text-muted-foreground">
            {{
              cultureResearchSources.length > 0
                ? copy("cultureEvidenceReady").replace(
                    "{count}",
                    String(cultureResearchSources.length)
                  )
                : copy("cultureEvidenceEmpty")
            }}
          </p>
        </div>
        <div class="grid gap-2">
          <Label for="preparation-practice-answer">{{ copy("practiceAnswer") }}</Label
          ><textarea
            id="preparation-practice-answer"
            v-model="practiceAnswer"
            class="min-h-24 rounded-lg border bg-background p-3"
          />
        </div>
        <Button
          class="w-fit"
          :disabled="!posting?.currentVersionId || !providerId || reviewing || running"
          @click="review"
          ><ShieldCheck />{{ revision ? copy("regenerate") : copy("generate") }}</Button
        >
      </CardContent></Card
    >
    <Card v-if="revision"
      ><CardHeader class="flex-row flex-wrap items-center justify-between gap-3"
        ><CardTitle>{{ copy("result") }}</CardTitle
        ><Badge>{{ copy("version") }} {{ revision.number }}</Badge></CardHeader
      ><CardContent>
        <article class="grid gap-5">
          <div class="rounded-2xl bg-foreground p-6 text-background">
            <p class="text-xs uppercase tracking-widest text-background/60">{{ copy("result") }}</p>
            <h2 class="mt-2 text-2xl font-semibold">{{ resultTitle }}</h2>
            <p class="mt-3 leading-7 text-background/80">{{ resultSummary }}</p>
          </div>
          <Card v-if="workflow === 'resume_feedback'" class="border-primary/30 bg-primary/5">
            <CardHeader
              ><CardTitle>{{ copy("evidenceGaps") }}</CardTitle></CardHeader
            >
            <CardContent>
              <p v-if="evidenceGaps.length === 0" class="text-sm text-muted-foreground">
                {{ copy("noExplicitGaps") }}
              </p>
              <ul v-else class="grid gap-3">
                <li
                  v-for="section in evidenceGaps"
                  :key="section.heading"
                  class="rounded-lg border bg-background p-4"
                >
                  <strong>{{ section.heading }}</strong>
                  <p class="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                    {{ section.body }}
                  </p>
                </li>
              </ul>
            </CardContent>
          </Card>
          <section v-if="resultSections.length" class="grid gap-4">
            <article
              v-for="section in resultSections"
              :key="section.heading"
              class="rounded-xl border p-5"
            >
              <h3 class="text-lg font-semibold">{{ section.heading }}</h3>
              <p class="mt-3 whitespace-pre-wrap text-sm leading-7">{{ section.body }}</p>
              <ul
                v-if="section.citations.length"
                class="mt-4 grid gap-1 text-xs text-muted-foreground"
              >
                <li v-for="citation in section.citations" :key="citation.sourceId">
                  {{ copy("citation") }} · {{ citation.note }}
                </li>
              </ul>
            </article>
          </section>
          <section v-if="resultQuestions.length" class="grid gap-4">
            <article
              v-for="(question, index) in resultQuestions"
              :key="question.question"
              class="rounded-xl border p-5"
            >
              <Badge variant="outline">Q{{ index + 1 }}</Badge>
              <h3 class="mt-3 text-lg font-semibold">{{ question.question }}</h3>
              <p class="mt-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {{ copy("suggestedAnswer") }}
              </p>
              <p class="mt-2 whitespace-pre-wrap text-sm leading-7">
                {{ question.suggestedAnswer }}
              </p>
              <p class="mt-4 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                <strong>{{ copy("rationale") }}</strong> · {{ question.rationale }}
              </p>
              <ul
                v-if="question.citations.length"
                class="mt-3 grid gap-1 text-xs text-muted-foreground"
              >
                <li v-for="citation in question.citations" :key="citation.sourceId">
                  {{ copy("citation") }} · {{ citation.note }}
                </li>
              </ul>
            </article>
          </section>
        </article>
        <div class="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" @click="copyResult"
            ><Clipboard />{{ copy("copyResult") }}</Button
          ><Button variant="outline" @click="exportResult"><Download />{{ copy("export") }}</Button
          ><Button variant="outline" :disabled="running" @click="loadProvenance()"
            ><ShieldCheck />{{ copy("refreshProvenance") }}</Button
          ><Button variant="secondary" :disabled="reviewing || running" @click="review"
            ><RotateCw />{{ copy("regenerate") }}</Button
          >
        </div></CardContent
      ></Card
    >
    <Card v-if="provenance">
      <CardHeader class="flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>{{ copy("provenance") }}</CardTitle>
        <Badge :variant="provenance.staleReasons.length === 0 ? 'secondary' : 'destructive'">
          {{ provenance.staleReasons.length === 0 ? copy("current") : copy("staleStatus") }}
        </Badge>
      </CardHeader>
      <CardContent class="grid gap-5 text-sm">
        <div class="grid gap-1">
          <p class="font-medium">{{ copy("providerContext") }}</p>
          <p class="text-muted-foreground">
            {{ provenance.providerId }} · {{ provenance.providerMode }} ·
            {{ provenance.providerModel }}
          </p>
        </div>
        <div class="grid gap-1">
          <p class="font-medium">{{ copy("promptContext") }}</p>
          <p class="text-muted-foreground">
            {{ provenance.promptTemplateId }} · r{{ provenance.promptTemplateRevision }}
          </p>
        </div>
        <div>
          <p class="font-medium">{{ copy("inputs") }}</p>
          <ul class="mt-2 grid gap-2">
            <li v-for="input in provenance.inputs" :key="input.hash" class="rounded border p-3">
              {{ input.label }} · v{{ input.version ?? "-" }}<br />
              <code class="text-xs text-muted-foreground">{{ input.hash.slice(0, 12) }}…</code>
            </li>
          </ul>
        </div>
        <div v-if="provenance.staleReasons.length" class="grid gap-2">
          <p class="font-medium text-destructive">{{ copy("staleReasons") }}</p>
          <ul class="grid gap-1 text-destructive">
            <li v-for="reason in provenance.staleReasons" :key="reason">
              {{ copy(`stale.${reason}`) }}
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
    <Dialog
      :open="preview !== null"
      @update:open="
        (value) => {
          if (!value) preview = null
        }
      "
      ><DialogContent class="max-h-[90vh] overflow-y-auto"
        ><DialogHeader
          ><DialogTitle>{{ copy("review") }}</DialogTitle
          ><DialogDescription>{{ copy("copy") }}</DialogDescription></DialogHeader
        >
        <div v-if="preview" class="grid gap-4 text-sm">
          <p v-if="running" class="flex items-center gap-3 text-muted-foreground" role="status">
            <span class="size-2 animate-pulse rounded-full bg-primary" />
            {{ copy("backgroundRunning") }}<span v-if="taskPhaseCopy"> · {{ taskPhaseCopy }}</span>
          </p>
          <div>
            <p class="font-medium">{{ copy("destination") }}</p>
            <p>{{ preview.manifest.destination }} · {{ preview.manifest.model }}</p>
          </div>
          <div>
            <p class="font-medium">{{ copy("inputs") }}</p>
            <ul class="mt-2 grid gap-2">
              <li
                v-for="input in preview.manifest.inputs"
                :key="input.hash"
                class="rounded border p-3"
              >
                {{ input.label }} · v{{ input.version ?? "-" }}<br /><code class="text-xs"
                  >{{ input.hash.slice(0, 12) }}…</code
                >
              </li>
            </ul>
          </div>
        </div>
        <DialogFooter
          ><Button variant="outline" :disabled="running" @click="preview = null">{{
            copy("cancel")
          }}</Button
          ><Button :disabled="running" @click="generate">{{
            copy("confirm")
          }}</Button></DialogFooter
        ></DialogContent
      ></Dialog
    >
  </div>
</template>
