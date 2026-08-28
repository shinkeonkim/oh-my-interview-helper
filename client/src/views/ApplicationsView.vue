<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { Archive, BriefcaseBusiness, CalendarPlus, History, Plus, Sparkles } from "lucide-vue-next"
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

type Source = "manual" | "file" | "url"
type Posting = {
  id: string
  title: string
  companyName: string
  teamName: string | null
  state: string
  versionNumber: number
  sourceKind: Source
}
type Stage = { id: string; key: string; name: string; position: number; outcome: string | null }
type Application = {
  id: string
  jobPostId: string
  stageId: string
  stageName: string
  appliedAt: string | null
  outcomeAt: string | null
  archivedAt: string | null
}
type HistoryEntry = {
  id: string
  sequence: number
  kind: string
  payload: Record<string, unknown>
  createdAt: string
}

const settings = useSettingsStore()
const copy = (key: string) => translate(settings.locale, `applications.${key}`)
const postings = ref<Posting[]>([])
const applications = ref<Application[]>([])
const stages = ref<Stage[]>([])
const source = ref<Source>("manual")
const title = ref("")
const company = ref("")
const team = ref("")
const body = ref("")
const sourceUrl = ref("")
const file = ref<File | null>(null)
const selectedStages = ref<Record<string, string>>({})
const note = ref("")
const interviewAt = ref("")
const interviewKind = ref("")
const activeApplication = ref<string | null>(null)
const history = ref<HistoryEntry[]>([])
const interviews = ref<Array<{ id: string; scheduledAt: string; kind: string; notes: string }>>([])
const newStage = ref("")
const loadController = new AbortController()
const postingById = computed(() => new Map(postings.value.map((posting) => [posting.id, posting])))

const csrf = async () =>
  ((await (await fetch("/api/security/csrf")).json()) as { csrfToken: string }).csrfToken
const request = async (path: string, method: string, value?: FormData | string) => {
  const headers: Record<string, string> = { "X-CSRF-Token": await csrf() }
  if (typeof value === "string") headers["Content-Type"] = "application/json"
  const response = await fetch(path, { method, body: value, headers })
  if (!response.ok) throw new Error("request")
  return response
}
const load = async () => {
  const [postResponse, applicationResponse, stageResponse] = await Promise.all([
    fetch("/api/postings", { signal: loadController.signal }),
    fetch("/api/applications", { signal: loadController.signal }),
    fetch("/api/pipeline/stages", { signal: loadController.signal })
  ])
  postings.value = ((await postResponse.json()) as { postings: Posting[] }).postings
  applications.value = (
    (await applicationResponse.json()) as { applications: Application[] }
  ).applications
  stages.value = ((await stageResponse.json()) as { stages: Stage[] }).stages
  selectedStages.value = Object.fromEntries(
    applications.value.map((item) => [item.id, item.stageId])
  )
}

const savePosting = async () => {
  try {
    if (source.value === "file") {
      if (file.value === null) throw new Error("file")
      const form = new FormData()
      form.set("title", title.value)
      form.set("companyName", company.value)
      form.set("teamName", team.value)
      form.set("file", file.value)
      await request("/api/postings/file", "POST", form)
    } else {
      await request(
        `/api/postings/${source.value}`,
        "POST",
        JSON.stringify({
          title: title.value,
          companyName: company.value,
          teamName: team.value || null,
          ...(source.value === "url" ? { url: sourceUrl.value } : { text: body.value })
        })
      )
    }
    title.value = company.value = team.value = body.value = sourceUrl.value = ""
    file.value = null
    toast.success(copy("saved"))
    await load()
  } catch {
    toast.error(copy("failed"))
  }
}
const startApplication = async (post: Posting) => {
  try {
    await request(
      "/api/applications",
      "POST",
      JSON.stringify({ jobPostId: post.id, idempotencyKey: crypto.randomUUID() })
    )
    await load()
  } catch {
    toast.error(copy("failed"))
  }
}
const move = async (application: Application) => {
  try {
    await request(
      `/api/applications/${application.id}/transition`,
      "POST",
      JSON.stringify({ stageId: selectedStages.value[application.id] })
    )
    await load()
  } catch {
    toast.error(copy("failed"))
    await load()
  }
}
const addNote = async () => {
  if (activeApplication.value === null) return
  try {
    await request(
      `/api/applications/${activeApplication.value}/notes`,
      "POST",
      JSON.stringify({ text: note.value })
    )
    note.value = ""
    await showHistory(activeApplication.value)
  } catch {
    toast.error(copy("failed"))
  }
}
const schedule = async () => {
  if (activeApplication.value === null) return
  try {
    await request(
      `/api/applications/${activeApplication.value}/interviews`,
      "POST",
      JSON.stringify({
        scheduledAt: new Date(interviewAt.value).toISOString(),
        kind: interviewKind.value,
        location: null,
        notes: ""
      })
    )
    interviewAt.value = interviewKind.value = ""
    await showHistory(activeApplication.value)
  } catch {
    toast.error(copy("failed"))
  }
}
const showHistory = async (id: string) => {
  const response = await fetch(`/api/applications/${id}/history`)
  if (!response.ok) {
    toast.error(copy("failed"))
    return
  }
  const value = (await response.json()) as {
    events: HistoryEntry[]
    interviews: typeof interviews.value
  }
  activeApplication.value = id
  history.value = value.events
  interviews.value = value.interviews
}
const archivePosting = async (post: Posting) => {
  try {
    await request(`/api/postings/${post.id}/archive`, "POST")
    await load()
  } catch {
    toast.error(copy("failed"))
  }
}
const addStage = async () => {
  try {
    const key = `custom_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`
    await request("/api/pipeline/stages", "POST", JSON.stringify({ key, name: newStage.value }))
    newStage.value = ""
    await load()
  } catch {
    toast.error(copy("failed"))
  }
}
onMounted(() => void load().catch(() => toast.error(copy("failed"))))
onBeforeUnmount(() => loadController.abort())
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
        ><CardTitle>{{ copy("addPosting") }}</CardTitle></CardHeader
      ><CardContent class="grid gap-4">
        <div class="grid gap-4 md:grid-cols-3">
          <div class="grid gap-2">
            <Label>{{ copy("roleTitle") }}</Label
            ><Input v-model="title" />
          </div>
          <div class="grid gap-2">
            <Label>{{ copy("company") }}</Label
            ><Input v-model="company" />
          </div>
          <div class="grid gap-2">
            <Label>{{ copy("team") }}</Label
            ><Input v-model="team" />
          </div>
        </div>
        <div class="grid gap-2">
          <Label>{{ copy("addPosting") }}</Label
          ><Select v-model="source"
            ><SelectTrigger class="w-44"><SelectValue /></SelectTrigger
            ><SelectContent
              ><SelectItem value="manual">{{ copy("manual") }}</SelectItem
              ><SelectItem value="file">{{ copy("file") }}</SelectItem
              ><SelectItem value="url">{{ copy("url") }}</SelectItem></SelectContent
            ></Select
          >
        </div>
        <textarea
          v-if="source === 'manual'"
          v-model="body"
          class="min-h-32 rounded-lg border bg-background p-3"
          :placeholder="copy('body')"
        />
        <Input
          v-else-if="source === 'url'"
          v-model="sourceUrl"
          type="url"
          :placeholder="copy('sourceUrl')"
        />
        <Input
          v-else
          type="file"
          accept=".pdf,.docx,.md,.txt"
          @change="file = ($event.target as HTMLInputElement).files?.[0] ?? null"
        />
        <Button class="w-fit" @click="savePosting"><Plus />{{ copy("save") }}</Button>
      </CardContent></Card
    >

    <section>
      <h2 class="text-xl font-semibold">{{ copy("postings") }}</h2>
      <p v-if="postings.length === 0" class="mt-4 text-muted-foreground">
        {{ copy("emptyPostings") }}
      </p>
      <div class="mt-4 grid gap-4 lg:grid-cols-2">
        <Card v-for="post in postings" :key="post.id"
          ><CardHeader class="flex-row justify-between"
            ><div>
              <CardTitle>{{ post.title }}</CardTitle>
              <p class="mt-2 text-sm text-muted-foreground">
                {{ post.companyName }}<span v-if="post.teamName"> · {{ post.teamName }}</span>
              </p>
            </div>
            <Badge variant="outline"
              >{{ post.sourceKind }} · {{ copy("version") }} {{ post.versionNumber }}</Badge
            ></CardHeader
          ><CardContent class="flex gap-2"
            ><Button as-child variant="secondary"
              ><RouterLink :to="`/jobs/${post.id}/overview`"
                ><Sparkles />{{ copy("prepare") }}</RouterLink
              ></Button
            ><Button @click="startApplication(post)"
              ><BriefcaseBusiness />{{ copy("startApplication") }}</Button
            ><Button variant="ghost" @click="archivePosting(post)"
              ><Archive />{{ copy("archive") }}</Button
            ></CardContent
          ></Card
        >
      </div>
    </section>

    <section>
      <h2 class="text-xl font-semibold">{{ copy("applications") }}</h2>
      <p v-if="applications.length === 0" class="mt-4 text-muted-foreground">
        {{ copy("emptyApplications") }}
      </p>
      <div class="mt-4 grid gap-4">
        <Card v-for="application in applications" :key="application.id"
          ><CardContent class="flex flex-col gap-4 py-5 lg:flex-row lg:items-center"
            ><div class="min-w-48 flex-1">
              <p class="font-semibold">{{ postingById.get(application.jobPostId)?.title }}</p>
              <p class="text-sm text-muted-foreground">{{ application.stageName }}</p>
            </div>
            <Select v-model="selectedStages[application.id]"
              ><SelectTrigger class="w-48"><SelectValue /></SelectTrigger
              ><SelectContent
                ><SelectItem v-for="stage in stages" :key="stage.id" :value="stage.id">{{
                  stage.name
                }}</SelectItem></SelectContent
              ></Select
            ><Button variant="secondary" @click="move(application)">{{ copy("move") }}</Button
            ><Button variant="outline" @click="showHistory(application.id)"
              ><History />{{ copy("history") }}</Button
            ></CardContent
          ></Card
        >
      </div>
    </section>

    <Card v-if="activeApplication"
      ><CardHeader
        ><CardTitle>{{ copy("history") }}</CardTitle></CardHeader
      ><CardContent class="grid gap-6 lg:grid-cols-2"
        ><div class="grid gap-3">
          <div class="flex gap-2">
            <Input v-model="note" :placeholder="copy('notes')" /><Button @click="addNote">{{
              copy("addNote")
            }}</Button>
          </div>
          <div class="grid gap-2 sm:grid-cols-3">
            <Input v-model="interviewAt" type="datetime-local" /><Input
              v-model="interviewKind"
              :placeholder="copy('interviewKind')"
            /><Button @click="schedule"><CalendarPlus />{{ copy("scheduleInterview") }}</Button>
          </div>
        </div>
        <ol class="grid gap-2 text-sm">
          <li v-for="event in history" :key="event.id" class="rounded border p-3">
            #{{ event.sequence }} {{ event.kind }} ·
            {{ new Date(event.createdAt).toLocaleString(settings.locale) }}
          </li>
          <li v-for="interview in interviews" :key="interview.id" class="rounded border p-3">
            {{ interview.kind }} ·
            {{ new Date(interview.scheduledAt).toLocaleString(settings.locale) }}
          </li>
        </ol></CardContent
      ></Card
    >

    <Card
      ><CardHeader
        ><CardTitle>{{ copy("stages") }}</CardTitle></CardHeader
      ><CardContent
        ><div class="flex flex-wrap gap-2">
          <Badge v-for="stage in stages" :key="stage.id" variant="outline"
            >{{ stage.position }}. {{ stage.name }}</Badge
          >
        </div>
        <div class="mt-4 flex max-w-md gap-2">
          <Input v-model="newStage" :placeholder="copy('newStage')" /><Button @click="addStage">{{
            copy("addStage")
          }}</Button>
        </div></CardContent
      ></Card
    >
  </div>
</template>
