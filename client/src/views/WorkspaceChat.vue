<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { MessageCircle, Send, ShieldCheck } from "lucide-vue-next"
import { toast } from "vue-sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { translate } from "../locales"
import { useSettingsStore } from "../stores/settings"
import {
  backgroundTaskPhaseLabel,
  resumeBackgroundTask,
  runBackgroundTask
} from "../lib/background-task"

type Document = {
  id: string
  title: string
  state: string
  currentVersionId: string | null
  versionNumber: number | null
  selected: boolean
}
type ResearchSource = { id: string; title: string; url: string; status: string }
type Provider = { id: string; configured: boolean }
type Conversation = { id: string; title: string }
type Message = {
  id: string
  role: "system" | "user" | "assistant" | "tool"
  content: { text?: string; answer?: string; citations?: Array<{ sourceId: string; note: string }> }
}
type Manifest = {
  destination: string
  model: string
  action: string
  inputs: Array<{ label: string; version: number | null; hash: string }>
}
type DisplayLine = { text: string; kind: "heading" | "bullet" | "paragraph" }

const props = defineProps<{
  applicationId: string
  jobPostId: string
  postingTitle: string
  postingVersionId: string
}>()
const settings = useSettingsStore()
const copy = (key: string) => translate(settings.locale, `workspace.chat.${key}`)
const controller = new AbortController()
const documents = ref<Document[]>([])
const providers = ref<Provider[]>([])
const conversations = ref<Conversation[]>([])
const messages = ref<Message[]>([])
const conversationId = ref<string | null>(null)
const providerId = ref("")
const selectedDocumentVersionIds = ref<string[]>([])
const researchSources = ref<ResearchSource[]>([])
const selectedResearchSourceIds = ref<string[]>([])
const message = ref("")
const turnKey = ref(crypto.randomUUID())
const preview = ref<{ manifest: Manifest; authorizationToken: string } | null>(null)
const reviewing = ref(false)
const running = ref(false)
const taskPhase = ref<string | null>(null)
const taskPhaseCopy = computed(() => backgroundTaskPhaseLabel(taskPhase.value, settings.locale))
let contextId = 0
let loadRequestId = 0
const inputs = computed(() => {
  const selected: Array<Record<string, string>> = [
    { kind: "job_post_version", jobPostVersionId: props.postingVersionId }
  ]
  for (const documentVersionId of selectedDocumentVersionIds.value)
    selected.push({ kind: "document_version", documentVersionId })
  for (const researchSourceId of selectedResearchSourceIds.value)
    selected.push({ kind: "research_source", researchSourceId })
  return selected
})
const taskScope = computed(() => `chat:${props.applicationId}`)
const hostname = (url: string) => new URL(url).hostname
const messageLines = (item: Message): DisplayLine[] =>
  (item.content.text ?? item.content.answer ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({
      text: line.replaceAll("**", ""),
      kind: /^\*\*.+\*\*$/.test(line)
        ? ("heading" as const)
        : line.startsWith("- ")
          ? ("bullet" as const)
          : ("paragraph" as const)
    }))
const maximumResearchSources = 8
const toggleResearchSource = (sourceId: string) => {
  selectedResearchSourceIds.value = selectedResearchSourceIds.value.includes(sourceId)
    ? selectedResearchSourceIds.value.filter((id) => id !== sourceId)
    : selectedResearchSourceIds.value.length < maximumResearchSources
      ? [...selectedResearchSourceIds.value, sourceId]
      : selectedResearchSourceIds.value
}
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
const requestBody = () => ({
  conversationId: conversationId.value,
  applicationId: props.applicationId,
  title: props.postingTitle,
  message: message.value.trim(),
  providerId: providerId.value,
  turnKey: turnKey.value,
  inputs: inputs.value
})
const load = async () => {
  const requestId = ++loadRequestId
  const requestedApplicationId = props.applicationId
  try {
    const [documentsResponse, providersResponse, conversationsResponse, researchResponse] =
      await Promise.all([
        fetch("/api/documents", { signal: controller.signal }),
        fetch("/api/providers/status", { signal: controller.signal }),
        fetch(`/api/conversations?applicationId=${encodeURIComponent(requestedApplicationId)}`, {
          signal: controller.signal
        }),
        fetch(`/api/research?jobPostId=${encodeURIComponent(props.jobPostId)}`, {
          signal: controller.signal
        })
      ])
    if (
      !documentsResponse.ok ||
      !providersResponse.ok ||
      !conversationsResponse.ok ||
      !researchResponse.ok
    )
      throw new Error("request")
    const [documentValue, providerValue, conversationValue, researchValue] = await Promise.all([
      documentsResponse.json() as Promise<{ documents: Document[] }>,
      providersResponse.json() as Promise<{ providers: Provider[] }>,
      conversationsResponse.json() as Promise<{ conversations: Conversation[] }>,
      researchResponse.json() as Promise<{ records: Array<{ id: string }> }>
    ])
    const researchDetails = await Promise.all(
      researchValue.records.map(async (record) => {
        const response = await fetch(`/api/research/${record.id}`, { signal: controller.signal })
        return response.ok
          ? ((await response.json()) as { sources: ResearchSource[] })
          : { sources: [] }
      })
    )
    const configuredProviders = providerValue.providers.filter((item) => item.configured)
    const activeDocuments = documentValue.documents.filter(
      (item) => item.state === "active" && item.currentVersionId
    )
    const latest = conversationValue.conversations.at(-1)
    let latestMessages: Message[] = []
    if (latest !== undefined) {
      const response = await fetch(`/api/conversations/${latest.id}/messages`, {
        signal: controller.signal
      })
      if (!response.ok) throw new Error("request")
      latestMessages = ((await response.json()) as { messages: Message[] }).messages
    }
    if (requestId !== loadRequestId || requestedApplicationId !== props.applicationId) return
    documents.value = activeDocuments
    selectedDocumentVersionIds.value = activeDocuments
      .filter((item) => item.selected && item.currentVersionId !== null)
      .map((item) => item.currentVersionId as string)
    const uniqueResearchSources = new Map<string, ResearchSource>()
    for (const source of researchDetails
      .flatMap((item) => item.sources)
      .filter((item) => item.status === "available")) {
      const canonicalUrl = new URL(source.url)
      canonicalUrl.hash = ""
      const key = canonicalUrl.toString().replace(/\/$/, "")
      if (!uniqueResearchSources.has(key)) uniqueResearchSources.set(key, source)
    }
    researchSources.value = [...uniqueResearchSources.values()]
    selectedResearchSourceIds.value = (researchDetails[0]?.sources ?? [])
      .filter((item) => item.status === "available")
      .slice(0, maximumResearchSources)
      .map((item) => item.id)
    providers.value = configuredProviders
    conversations.value = conversationValue.conversations
    providerId.value = configuredProviders[0]?.id ?? ""
    conversationId.value = latest?.id ?? null
    messages.value = latestMessages
  } catch (error) {
    if (requestId === loadRequestId) throw error
  }
}
const review = async () => {
  if (!message.value.trim() || reviewing.value || running.value) return
  const operationContext = contextId
  const body = requestBody()
  reviewing.value = true
  try {
    const value = (await (await post("/api/conversations/preview", body)).json()) as {
      manifest: Manifest
      authorizationToken: string
    }
    if (operationContext === contextId) preview.value = value
  } catch {
    if (operationContext === contextId) toast.error(copy("failed"))
  } finally {
    if (operationContext === contextId) reviewing.value = false
  }
}
const send = async () => {
  if (!preview.value || running.value) return
  const operationContext = contextId
  const reviewed = preview.value
  const body = requestBody()
  running.value = true
  try {
    const confirmation = (await (
      await post("/api/disclosures/confirm", {
        authorizationToken: reviewed.authorizationToken
      })
    ).json()) as { id: string }
    if (operationContext !== contextId) return
    const result = (await runBackgroundTask(
      "ui.chat",
      { request: { ...body, disclosureId: confirmation.id } },
      await csrf(),
      (_state, phase) => (taskPhase.value = phase),
      controller.signal,
      taskScope.value
    )) as { conversation: Conversation; messages: Message[] }
    if (operationContext !== contextId) return
    applyTaskResult(result)
  } catch {
    if (operationContext === contextId) toast.error(copy("failed"))
  } finally {
    if (operationContext === contextId) {
      running.value = false
      taskPhase.value = null
    }
  }
}
const applyTaskResult = (result: { conversation: Conversation; messages: Message[] }) => {
  conversationId.value = result.conversation.id
  messages.value.push(...result.messages)
  if (!conversations.value.some((item) => item.id === result.conversation.id))
    conversations.value.push(result.conversation)
  message.value = ""
  preview.value = null
  turnKey.value = crypto.randomUUID()
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
      .then((result) => {
        if (operationContext === contextId)
          applyTaskResult(result as { conversation: Conversation; messages: Message[] })
      })
      .catch(() => operationContext === contextId && toast.error(copy("failed")))
      .finally(() => {
        if (operationContext === contextId) {
          running.value = false
          taskPhase.value = null
        }
      })
}
watch(
  () => props.applicationId,
  () => {
    contextId += 1
    loadRequestId += 1
    documents.value = []
    providers.value = []
    conversations.value = []
    messages.value = []
    conversationId.value = null
    providerId.value = ""
    selectedDocumentVersionIds.value = []
    researchSources.value = []
    selectedResearchSourceIds.value = []
    message.value = ""
    preview.value = null
    reviewing.value = false
    running.value = false
    turnKey.value = crypto.randomUUID()
    void load()
      .then(resumeTask)
      .catch(() => toast.error(copy("failed")))
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  contextId += 1
  loadRequestId += 1
  controller.abort()
})
</script>

<template>
  <Card class="lg:col-span-3">
    <CardHeader
      ><CardTitle class="flex items-center gap-2"
        ><MessageCircle />{{ copy("title") }}</CardTitle
      ></CardHeader
    >
    <CardContent class="grid gap-5">
      <div v-if="messages.length" class="grid gap-3" aria-live="polite">
        <article
          v-for="item in messages"
          :key="item.id"
          class="rounded-lg border p-4"
          :class="item.role === 'user' ? 'ml-8 bg-muted/50' : 'mr-8'"
        >
          <Badge variant="outline">{{
            item.role === "user" ? copy("you") : copy("assistant")
          }}</Badge>
          <div class="mt-3 grid gap-2 text-sm leading-6">
            <p
              v-for="(line, index) in messageLines(item)"
              :key="item.id + '-' + index"
              :class="{
                'mt-2 font-semibold text-foreground': line.kind === 'heading',
                'pl-4 before:-ml-4 before:content-[&quot;•_&quot;]': line.kind === 'bullet'
              }"
            >
              {{ line.kind === "bullet" ? line.text.slice(2) : line.text }}
            </p>
          </div>
          <ul
            v-if="item.content.citations?.length"
            class="mt-3 grid gap-1 text-xs text-muted-foreground"
          >
            <li v-for="citation in item.content.citations" :key="`${item.id}-${citation.sourceId}`">
              {{ copy("citation") }} · {{ citation.note }}
            </li>
          </ul>
        </article>
      </div>
      <p v-else class="text-sm text-muted-foreground">{{ copy("empty") }}</p>
      <p class="text-sm text-muted-foreground">{{ copy("automaticAgent") }}</p>
      <div class="grid gap-3">
        <Label>{{ copy("documents") }}</Label>
        <p class="text-sm text-muted-foreground">{{ copy("sourcesHelp") }}</p>
        <div class="grid gap-2 sm:grid-cols-2">
          <label
            v-for="document in documents"
            :key="document.id"
            class="flex min-h-11 items-center gap-3 rounded-xl border p-3"
          >
            <input
              v-model="selectedDocumentVersionIds"
              type="checkbox"
              :value="document.currentVersionId!"
            />
            <span class="text-sm">{{ document.title }} · v{{ document.versionNumber }}</span>
          </label>
        </div>
      </div>
      <div class="grid gap-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <Label>{{ copy("researchSources") }}</Label>
          <Button as-child variant="outline" size="sm"
            ><RouterLink :to="`/jobs/${jobPostId}/company`">{{
              copy("addResearch")
            }}</RouterLink></Button
          >
        </div>
        <p v-if="researchSources.length === 0" class="text-sm text-muted-foreground">
          {{ copy("noResearch") }}
        </p>
        <p v-else class="text-sm text-muted-foreground">
          {{ copy("researchSelectionHelp") }} · {{ selectedResearchSourceIds.length }}/{{
            maximumResearchSources
          }}
        </p>
        <div v-if="researchSources.length > 0" class="grid gap-2 sm:grid-cols-2">
          <label
            v-for="source in researchSources"
            :key="source.id"
            class="flex min-h-11 items-center gap-3 rounded-xl border p-3"
          >
            <input
              type="checkbox"
              :checked="selectedResearchSourceIds.includes(source.id)"
              :disabled="
                !selectedResearchSourceIds.includes(source.id) &&
                selectedResearchSourceIds.length >= maximumResearchSources
              "
              @change="toggleResearchSource(source.id)"
            />
            <span class="min-w-0 text-sm"
              ><strong class="block truncate">{{ source.title }}</strong
              ><small class="text-muted-foreground">{{ hostname(source.url) }}</small></span
            >
          </label>
        </div>
      </div>
      <div class="grid gap-2">
        <Label for="chat-message">{{ copy("message") }}</Label
        ><Textarea id="chat-message" v-model="message" :placeholder="copy('placeholder')" />
      </div>
      <Button
        class="w-fit"
        :disabled="!providerId || !message.trim() || reviewing || running"
        @click="review"
        ><ShieldCheck />{{ copy("review") }}</Button
      >
    </CardContent>
  </Card>

  <Dialog
    :open="preview !== null"
    @update:open="
      (open) => {
        if (!open) preview = null
      }
    "
  >
    <DialogContent class="max-h-[90vh] overflow-y-auto">
      <DialogHeader
        ><DialogTitle>{{ copy("disclosureTitle") }}</DialogTitle
        ><DialogDescription>{{ copy("disclosureCopy") }}</DialogDescription></DialogHeader
      >
      <div v-if="preview" class="grid gap-3 text-sm">
        <p v-if="running" class="flex items-center gap-3 text-muted-foreground" role="status">
          <span class="size-2 animate-pulse rounded-full bg-primary" />
          {{ copy("backgroundRunning") }}<span v-if="taskPhaseCopy"> · {{ taskPhaseCopy }}</span>
        </p>
        <p class="font-medium">{{ preview.manifest.destination }} · {{ preview.manifest.model }}</p>
        <ul class="grid gap-2">
          <li v-for="input in preview.manifest.inputs" :key="input.hash" class="rounded border p-3">
            {{ input.label }} · v{{ input.version ?? "-" }}
          </li>
        </ul>
      </div>
      <DialogFooter
        ><Button variant="outline" @click="preview = null">{{ copy("cancel") }}</Button
        ><Button :disabled="running" @click="send"
          ><Send />{{ running ? copy("sending") : copy("send") }}</Button
        ></DialogFooter
      >
    </DialogContent>
  </Dialog>
</template>
