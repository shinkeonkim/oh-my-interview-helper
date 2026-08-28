<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
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

type Workflow =
  | "cover_letter"
  | "resume_feedback"
  | "interview_prep"
  | "technical_prep"
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
type Manifest = {
  destination: string
  model: string
  action: string
  inputs: Array<{ type: string; label: string; version: number | null; hash: string }>
}
type Revision = {
  id: string
  seriesId: string
  number: number
  content: Record<string, unknown>
  providerId: string
  providerModel: string
}

const route = useRoute()
const settings = useSettingsStore()
const copy = (key: string) => translate(settings.locale, `preparation.${key}`)
const controller = new AbortController()
const postings = ref<Posting[]>([])
const documents = ref<Document[]>([])
const providers = ref<Provider[]>([])
const workflow = ref<Workflow>("cover_letter")
const providerId = ref("")
const documentVersionId = ref("none")
const practiceAnswer = ref("")
const generationKey = ref(crypto.randomUUID())
const preview = ref<{ manifest: Manifest; authorizationToken: string } | null>(null)
const revision = ref<Revision | null>(null)
const running = ref(false)
const posting = computed(() => postings.value.find((item) => item.id === route.params["postId"]))
const inputs = computed(() => {
  const values: Array<Record<string, string>> = []
  if (posting.value?.currentVersionId)
    values.push({ kind: "job_post_version", jobPostVersionId: posting.value.currentVersionId })
  if (documentVersionId.value !== "none")
    values.push({ kind: "document_version", documentVersionId: documentVersionId.value })
  return values
})
const workflowLabels: Array<[Workflow, string]> = [
  ["cover_letter", "coverLetter"],
  ["resume_feedback", "resumeFeedback"],
  ["interview_prep", "interviewPrep"],
  ["technical_prep", "technicalPrep"],
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
const requestBody = () => ({
  workflow: workflow.value,
  providerId: providerId.value,
  seriesId: revision.value?.seriesId ?? null,
  inputs: inputs.value,
  practiceAnswer: practiceAnswer.value.trim() || null,
  generationKey: generationKey.value
})
const load = async () => {
  const [postingsResponse, documentsResponse, providersResponse] = await Promise.all([
    fetch("/api/postings", { signal: controller.signal }),
    fetch("/api/documents", { signal: controller.signal }),
    fetch("/api/providers/status", { signal: controller.signal })
  ])
  postings.value = ((await postingsResponse.json()) as { postings: Posting[] }).postings
  documents.value = (
    (await documentsResponse.json()) as { documents: Document[] }
  ).documents.filter((item) => item.state === "active" && item.currentVersionId)
  providers.value = (
    (await providersResponse.json()) as { providers: Provider[] }
  ).providers.filter((item) => item.configured)
  providerId.value = providers.value[0]?.id ?? ""
}
const review = async () => {
  try {
    preview.value = (await (await post("/api/workflows/preview", requestBody())).json()) as {
      manifest: Manifest
      authorizationToken: string
    }
  } catch {
    toast.error(copy("failed"))
  }
}
const generate = async () => {
  if (!preview.value) return
  running.value = true
  try {
    const confirmation = (await (
      await post("/api/disclosures/confirm", {
        authorizationToken: preview.value.authorizationToken
      })
    ).json()) as { id: string }
    revision.value = (await (
      await post("/api/workflows/run", { ...requestBody(), disclosureId: confirmation.id })
    ).json()) as Revision
    preview.value = null
  } catch {
    toast.error(copy("failed"))
  } finally {
    running.value = false
    generationKey.value = crypto.randomUUID()
  }
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
const viewProvenance = () => {
  if (!revision.value) return
  window.open(
    `/api/artifacts/revisions/${revision.value.id}/provenance`,
    "_blank",
    "noopener,noreferrer"
  )
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
        <div class="grid gap-4 md:grid-cols-3">
          <div class="grid gap-2">
            <Label>{{ copy("workflow") }}</Label
            ><Select v-model="workflow"
              ><SelectTrigger><SelectValue /></SelectTrigger
              ><SelectContent
                ><SelectItem v-for="[value, label] in workflowLabels" :key="value" :value="value">{{
                  copy(label)
                }}</SelectItem></SelectContent
              ></Select
            >
          </div>
          <div class="grid gap-2">
            <Label>{{ copy("provider") }}</Label
            ><Select v-model="providerId"
              ><SelectTrigger><SelectValue /></SelectTrigger
              ><SelectContent
                ><SelectItem v-for="provider in providers" :key="provider.id" :value="provider.id"
                  >{{ provider.id }} · {{ provider.model.displayName }}</SelectItem
                ></SelectContent
              ></Select
            >
          </div>
          <div class="grid gap-2">
            <Label>{{ copy("document") }}</Label
            ><Select v-model="documentVersionId"
              ><SelectTrigger><SelectValue /></SelectTrigger
              ><SelectContent
                ><SelectItem value="none">{{ copy("noDocument") }}</SelectItem
                ><SelectItem
                  v-for="document in documents"
                  :key="document.id"
                  :value="document.currentVersionId!"
                  >{{ document.title }} · v{{ document.versionNumber }}</SelectItem
                ></SelectContent
              ></Select
            >
          </div>
        </div>
        <div class="grid gap-2">
          <Label>{{ copy("practiceAnswer") }}</Label
          ><textarea
            v-model="practiceAnswer"
            class="min-h-24 rounded-lg border bg-background p-3"
          />
        </div>
        <Button class="w-fit" :disabled="!posting?.currentVersionId || !providerId" @click="review"
          ><ShieldCheck />{{ revision ? copy("regenerate") : copy("generate") }}</Button
        >
      </CardContent></Card
    >
    <Card v-if="revision"
      ><CardHeader class="flex-row items-center justify-between"
        ><CardTitle>{{ copy("result") }}</CardTitle
        ><Badge>{{ copy("version") }} {{ revision.number }}</Badge></CardHeader
      ><CardContent>
        <pre
          class="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-5 text-sm"
          >{{ JSON.stringify(revision.content, null, 2) }}</pre>
        <div class="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" @click="copyResult"
            ><Clipboard />{{ copy("copyResult") }}</Button
          ><Button variant="outline" @click="exportResult"><Download />{{ copy("export") }}</Button
          ><Button variant="outline" @click="viewProvenance"
            ><ShieldCheck />{{ copy("provenance") }}</Button
          ><Button variant="secondary" @click="review"><RotateCw />{{ copy("regenerate") }}</Button>
        </div></CardContent
      ></Card
    >
    <Dialog
      :open="preview !== null"
      @update:open="
        (value) => {
          if (!value) preview = null
        }
      "
      ><DialogContent
        ><DialogHeader
          ><DialogTitle>{{ copy("review") }}</DialogTitle
          ><DialogDescription>{{ copy("copy") }}</DialogDescription></DialogHeader
        >
        <div v-if="preview" class="grid gap-4 text-sm">
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
          ><Button variant="outline" @click="preview = null">{{ copy("cancel") }}</Button
          ><Button :disabled="running" @click="generate">{{
            copy("confirm")
          }}</Button></DialogFooter
        ></DialogContent
      ></Dialog
    >
  </div>
</template>
