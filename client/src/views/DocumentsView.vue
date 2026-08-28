<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { Archive, Download, Eye, FileText, Trash2, Upload } from "lucide-vue-next"
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
import { translate } from "../locales"
import { useSettingsStore } from "../stores/settings"

type Kind = "resume" | "portfolio" | "cover_letter" | "supporting"
type DocumentItem = {
  id: string
  kind: Kind
  title: string
  state: "active" | "archived"
  selected: boolean
  currentVersionId: string
  versionNumber: number
  displayName: string
  byteSize: number
  extractionStatus: "completed" | "failed"
  usageCount: number
}

const settings = useSettingsStore()
const copy = (key: string) => translate(settings.locale, `documents.${key}`)
const documents = ref<DocumentItem[]>([])
const kind = ref<Kind>("resume")
const loading = ref(true)
const uploading = ref(false)
const pendingDocumentIds = ref<ReadonlySet<string>>(new Set())
const preview = ref<{ title: string; text: string } | null>(null)
const history = ref<{
  title: string
  versions: Array<{ id: string; versionNumber: number; displayName: string; createdAt: string }>
} | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const kindLabels = computed<Record<Kind, string>>(() => ({
  resume: copy("resume"),
  portfolio: copy("portfolio"),
  cover_letter: copy("coverLetter"),
  supporting: copy("supporting")
}))

const load = async () => {
  loading.value = true
  try {
    const response = await fetch("/api/documents")
    if (!response.ok) throw new Error("load")
    documents.value = ((await response.json()) as { documents: DocumentItem[] }).documents
  } catch {
    toast.error(copy("failed"))
  } finally {
    loading.value = false
  }
}

const csrf = async (): Promise<string> => {
  const response = await fetch("/api/security/csrf")
  return ((await response.json()) as { csrfToken: string }).csrfToken
}

const mutate = async (path: string, method: string, body?: FormData) => {
  const response = await fetch(path, { method, body, headers: { "X-CSRF-Token": await csrf() } })
  if (!response.ok) throw new Error("mutation")
}
const setDocumentPending = (id: string, pending: boolean) => {
  const next = new Set(pendingDocumentIds.value)
  if (pending) next.add(id)
  else next.delete(id)
  pendingDocumentIds.value = next
}

const uploadFiles = async (event: Event) => {
  const input = event.target as HTMLInputElement
  if (input.files === null || input.files.length === 0) return
  uploading.value = true
  const form = new FormData()
  form.set("kind", kind.value)
  for (const file of input.files) form.append("files", file)
  try {
    await mutate("/api/documents/upload", "POST", form)
    toast.success(copy("saved"))
    await load()
  } catch {
    toast.error(copy("failed"))
  } finally {
    uploading.value = false
    input.value = ""
  }
}

const uploadVersion = async (event: Event, document: DocumentItem) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (
    file === undefined ||
    document.state !== "active" ||
    pendingDocumentIds.value.has(document.id)
  )
    return
  setDocumentPending(document.id, true)
  const form = new FormData()
  form.set("file", file)
  try {
    await mutate(`/api/documents/${document.id}/versions`, "POST", form)
    toast.success(copy("saved"))
    await load()
  } catch {
    toast.error(copy("failed"))
  } finally {
    setDocumentPending(document.id, false)
    input.value = ""
  }
}

const toggleSelection = async (document: DocumentItem) => {
  if (document.state !== "active" || pendingDocumentIds.value.has(document.id)) return
  setDocumentPending(document.id, true)
  try {
    await mutate(`/api/documents/${document.id}/selection`, document.selected ? "DELETE" : "PUT")
    await load()
  } catch {
    toast.error(copy("failed"))
  } finally {
    setDocumentPending(document.id, false)
  }
}

const transition = async (document: DocumentItem, action: "archive" | "delete") => {
  if (pendingDocumentIds.value.has(document.id)) return
  setDocumentPending(document.id, true)
  try {
    await mutate(`/api/documents/${document.id}/${action}`, "POST")
    await load()
  } catch {
    toast.error(copy("failed"))
  } finally {
    setDocumentPending(document.id, false)
  }
}

const showPreview = async (document: DocumentItem) => {
  const response = await fetch(`/api/documents/${document.id}/preview`)
  if (!response.ok) {
    toast.error(copy("failed"))
    return
  }
  preview.value = (await response.json()) as { title: string; text: string }
}

const showHistory = async (document: DocumentItem) => {
  const response = await fetch(`/api/documents/${document.id}/versions`)
  if (!response.ok) {
    toast.error(copy("failed"))
    return
  }
  history.value = {
    title: document.title,
    ...((await response.json()) as {
      versions: Array<{ id: string; versionNumber: number; displayName: string; createdAt: string }>
    })
  }
}

onMounted(load)
</script>

<template>
  <div class="grid gap-8">
    <section class="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
      <div>
        <p class="eyebrow">{{ copy("overline") }}</p>
        <h1 class="page-title mt-4">{{ copy("title") }}</h1>
        <p class="route-copy mt-4">{{ copy("copy") }}</p>
      </div>
      <div class="flex flex-wrap items-end gap-3">
        <div class="grid gap-2">
          <Label for="document-kind">{{ copy("kind") }}</Label>
          <Select v-model="kind">
            <SelectTrigger id="document-kind" class="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="(label, value) in kindLabels" :key="value" :value="value">{{
                label
              }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <input
          ref="fileInput"
          class="sr-only"
          type="file"
          multiple
          accept=".pdf,.docx,.md,.txt"
          @change="uploadFiles"
        />
        <Button size="lg" :disabled="uploading" @click="fileInput?.click()"
          ><Upload />{{ copy("upload") }}</Button
        >
      </div>
    </section>

    <p class="text-sm text-muted-foreground">{{ copy("uploadHelp") }}</p>
    <p v-if="loading" role="status">{{ copy("loading") }}</p>
    <Card v-else-if="documents.length === 0"
      ><CardContent class="py-12 text-center text-muted-foreground">{{
        copy("empty")
      }}</CardContent></Card
    >
    <section v-else class="grid gap-4 xl:grid-cols-2" aria-live="polite">
      <Card
        v-for="document in documents"
        :key="document.id"
        :aria-busy="pendingDocumentIds.has(document.id)"
      >
        <CardHeader class="flex-row items-start justify-between gap-4">
          <div class="flex gap-3">
            <FileText class="mt-1 size-5 text-primary" />
            <div>
              <CardTitle>{{ document.title }}</CardTitle>
              <p class="mt-2 text-sm text-muted-foreground">
                {{ kindLabels[document.kind] }} · {{ copy("version") }}
                {{ document.versionNumber }} · {{ Math.ceil(document.byteSize / 1024) }} KB
              </p>
            </div>
          </div>
          <Badge :variant="document.selected ? 'default' : 'outline'">{{
            document.state === "archived"
              ? copy("archived")
              : document.selected
                ? copy("selected")
                : document.extractionStatus
          }}</Badge>
        </CardHeader>
        <CardContent class="grid gap-4">
          <p class="text-xs text-muted-foreground">
            {{ copy("usage") }}: {{ document.usageCount }}
          </p>
          <div class="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              :disabled="document.state !== 'active' || pendingDocumentIds.has(document.id)"
              @click="toggleSelection(document)"
              >{{ document.selected ? copy("unselect") : copy("select") }}</Button
            >
            <Button variant="outline" @click="showPreview(document)"
              ><Eye />{{ copy("preview") }}</Button
            >
            <Button variant="outline" @click="showHistory(document)">{{ copy("history") }}</Button>
            <Button
              variant="outline"
              as-child
              :disabled="document.state !== 'active' || pendingDocumentIds.has(document.id)"
              ><label
                :class="
                  document.state === 'active' && !pendingDocumentIds.has(document.id)
                    ? 'cursor-pointer'
                    : 'cursor-not-allowed'
                "
                ><input
                  class="sr-only"
                  type="file"
                  accept=".pdf,.docx,.md,.txt"
                  :disabled="document.state !== 'active' || pendingDocumentIds.has(document.id)"
                  @change="uploadVersion($event, document)"
                />{{ copy("newVersion") }}</label
              ></Button
            >
            <Button variant="outline" as-child
              ><a :href="`/api/documents/${document.id}/download`"
                ><Download />{{ copy("download") }}</a
              ></Button
            >
            <Button
              v-if="document.state === 'active'"
              variant="ghost"
              :disabled="pendingDocumentIds.has(document.id)"
              @click="transition(document, 'archive')"
              ><Archive />{{ copy("archive") }}</Button
            >
            <Button
              variant="destructive"
              :disabled="pendingDocumentIds.has(document.id)"
              @click="transition(document, 'delete')"
              ><Trash2 />{{ copy("remove") }}</Button
            >
          </div>
        </CardContent>
      </Card>
    </section>

    <Card v-if="preview">
      <CardHeader class="flex-row items-center justify-between"
        ><CardTitle>{{ preview.title }}</CardTitle
        ><Button variant="ghost" @click="preview = null">{{
          translate(settings.locale, "actions.close")
        }}</Button></CardHeader
      >
      <CardContent>
        <pre
          class="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-5 text-sm leading-7"
          >{{ preview.text }}</pre>
      </CardContent>
    </Card>
    <Card v-if="history">
      <CardHeader class="flex-row items-center justify-between"
        ><CardTitle>{{ history.title }} · {{ copy("history") }}</CardTitle
        ><Button variant="ghost" @click="history = null">{{
          translate(settings.locale, "actions.close")
        }}</Button></CardHeader
      >
      <CardContent>
        <ol class="grid gap-3">
          <li
            v-for="version in history.versions"
            :key="version.id"
            class="flex justify-between gap-4 rounded-lg border p-3 text-sm"
          >
            <span
              >{{ copy("version") }} {{ version.versionNumber }} · {{ version.displayName }}</span
            >
            <time :datetime="version.createdAt">{{
              new Date(version.createdAt).toLocaleDateString(settings.locale)
            }}</time>
          </li>
        </ol>
      </CardContent>
    </Card>
  </div>
</template>
