<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import {
  Archive,
  ArrowDown,
  ArrowUp,
  BriefcaseBusiness,
  CalendarPlus,
  History,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2
} from "lucide-vue-next"
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
  canonicalUrl: string | null
  metadata?: { location?: unknown; employmentType?: unknown }
}
type PostingVersion = {
  id: string
  versionNumber: number
  sourceKind: Source
  createdAt: string
}
type Stage = {
  id: string
  key: string
  name: string
  position: number
  outcome: string | null
  system: boolean
}
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
const startingPostIds = ref<ReadonlySet<string>>(new Set())
const stages = ref<Stage[]>([])
const stageNames = ref<Record<string, string>>({})
const source = ref<Source>("manual")
const title = ref("")
const company = ref("")
const team = ref("")
const location = ref("")
const employmentType = ref("")
const body = ref("")
const sourceUrl = ref("")
const file = ref<File | null>(null)
const selectedStages = ref<Record<string, string>>({})
const note = ref("")
const interviewAt = ref("")
const interviewKind = ref("")
const interviewLocation = ref("")
const interviewNotes = ref("")
const activeApplication = ref<string | null>(null)
const history = ref<HistoryEntry[]>([])
const interviews = ref<
  Array<{
    id: string
    scheduledAt: string
    kind: string
    location: string | null
    notes: string
  }>
>([])
const newStage = ref("")
const activePost = ref<Posting | null>(null)
const postingVersions = ref<PostingVersion[]>([])
const versionSource = ref<Source>("url")
const updateUrl = ref("")
const versionBody = ref("")
const versionFile = ref<File | null>(null)
const updatingPost = ref(false)
const loadController = new AbortController()
const postingById = computed(() => new Map(postings.value.map((posting) => [posting.id, posting])))
const stageById = computed(() => new Map(stages.value.map((stage) => [stage.id, stage.name])))
const activeApplicationPostIds = computed(
  () =>
    new Set(
      applications.value.filter((item) => item.archivedAt === null).map((item) => item.jobPostId)
    )
)

const payloadText = (event: HistoryEntry, key: string) => {
  const value = event.payload[key]
  return typeof value === "string" ? value : null
}
const eventTitle = (event: HistoryEntry) => {
  const known: Record<string, string> = {
    created: "eventCreated",
    stage_changed: "eventStageChanged",
    note_added: "eventNoteAdded",
    interview_scheduled: "eventInterviewScheduled"
  }
  const key = known[event.kind]
  return key === undefined ? copy("eventOther") : copy(key)
}
const eventDetail = (event: HistoryEntry) => {
  if (event.kind === "created") {
    const stageId = payloadText(event, "stageId")
    return stageId === null ? "" : (stageById.value.get(stageId) ?? "")
  }
  if (event.kind === "stage_changed") {
    const from = payloadText(event, "fromStageId")
    const to = payloadText(event, "toStageId")
    if (from === null || to === null) return ""
    return `${stageById.value.get(from) ?? copy("unknownStage")} → ${stageById.value.get(to) ?? copy("unknownStage")}`
  }
  if (event.kind === "note_added") return payloadText(event, "text") ?? ""
  if (event.kind === "interview_scheduled") return payloadText(event, "kind") ?? ""
  return ""
}

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
  stageNames.value = Object.fromEntries(stages.value.map((stage) => [stage.id, stage.name]))
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
      form.set("location", location.value)
      form.set("employmentType", employmentType.value)
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
          location: location.value || null,
          employmentType: employmentType.value || null,
          ...(source.value === "url" ? { url: sourceUrl.value } : { text: body.value })
        })
      )
    }
    title.value = company.value = team.value = location.value = employmentType.value = ""
    body.value = sourceUrl.value = ""
    file.value = null
    toast.success(copy("saved"))
    await load()
  } catch {
    toast.error(copy("failed"))
  }
}
const startApplication = async (post: Posting) => {
  if (startingPostIds.value.has(post.id) || activeApplicationPostIds.value.has(post.id)) return
  startingPostIds.value = new Set([...startingPostIds.value, post.id])
  try {
    await request(
      "/api/applications",
      "POST",
      JSON.stringify({ jobPostId: post.id, idempotencyKey: crypto.randomUUID() })
    )
    await load()
  } catch {
    toast.error(copy("failed"))
  } finally {
    const next = new Set(startingPostIds.value)
    next.delete(post.id)
    startingPostIds.value = next
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
const archiveApplication = async (application: Application) => {
  try {
    await request(`/api/applications/${application.id}/archive`, "POST")
    if (activeApplication.value === application.id) activeApplication.value = null
    await load()
    toast.success(copy("applicationArchived"))
  } catch {
    toast.error(copy("failed"))
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
        location: interviewLocation.value.trim() || null,
        notes: interviewNotes.value.trim()
      })
    )
    interviewAt.value = interviewKind.value = interviewLocation.value = interviewNotes.value = ""
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
    if (activePost.value?.id === post.id) activePost.value = null
    await load()
    toast.success(copy("postingArchived"))
  } catch {
    toast.error(copy("failed"))
  }
}
const showVersions = async (post: Posting) => {
  try {
    const response = await fetch(`/api/postings/${post.id}/versions`)
    if (!response.ok) throw new Error("request")
    const body = (await response.json()) as { versions?: unknown }
    if (!Array.isArray(body.versions)) throw new Error("response")
    activePost.value = post
    postingVersions.value = body.versions as PostingVersion[]
    versionSource.value = post.canonicalUrl === null ? "manual" : "url"
    updateUrl.value = post.canonicalUrl ?? ""
    versionBody.value = ""
    versionFile.value = null
  } catch {
    toast.error(copy("failed"))
  }
}
const addPostingVersion = async () => {
  if (activePost.value === null) return
  updatingPost.value = true
  try {
    if (versionSource.value === "file") {
      if (versionFile.value === null) throw new Error("file")
      const form = new FormData()
      form.set("file", versionFile.value)
      await request(`/api/postings/${activePost.value.id}/versions/file`, "POST", form)
    } else {
      await request(
        `/api/postings/${activePost.value.id}/versions/${versionSource.value}`,
        "POST",
        JSON.stringify(
          versionSource.value === "url" ? { url: updateUrl.value } : { text: versionBody.value }
        )
      )
    }
    await load()
    const refreshed = postings.value.find((post) => post.id === activePost.value?.id)
    if (refreshed !== undefined) await showVersions(refreshed)
    toast.success(copy("versionSaved"))
  } catch {
    toast.error(copy("failed"))
  } finally {
    updatingPost.value = false
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
const renameStage = async (stage: Stage) => {
  try {
    await request(
      `/api/pipeline/stages/${stage.id}`,
      "PATCH",
      JSON.stringify({ name: stageNames.value[stage.id] })
    )
    await load()
    toast.success(copy("stageSaved"))
  } catch {
    toast.error(copy("failed"))
  }
}
const moveStage = async (stage: Stage, offset: -1 | 1) => {
  const ordered = [...stages.value].sort((left, right) => left.position - right.position)
  const index = ordered.findIndex((item) => item.id === stage.id)
  const target = index + offset
  if (index < 0 || target < 0 || target >= ordered.length) return
  ;[ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!]
  try {
    await request(
      "/api/pipeline/stages/order",
      "PUT",
      JSON.stringify({ stageIds: ordered.map((item) => item.id) })
    )
    await load()
  } catch {
    toast.error(copy("failed"))
  }
}
const deleteStage = async (stage: Stage) => {
  try {
    await request(`/api/pipeline/stages/${stage.id}`, "DELETE")
    await load()
    toast.success(copy("stageDeleted"))
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
          <div class="grid gap-2">
            <Label>{{ copy("location") }}</Label
            ><Input v-model="location" />
          </div>
          <div class="grid gap-2">
            <Label>{{ copy("employmentType") }}</Label
            ><Input v-model="employmentType" />
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
              <p
                v-if="
                  typeof post.metadata?.location === 'string' ||
                  typeof post.metadata?.employmentType === 'string'
                "
                class="mt-1 text-sm text-muted-foreground"
              >
                <span v-if="typeof post.metadata?.location === 'string'">{{
                  post.metadata?.location
                }}</span>
                <span
                  v-if="
                    typeof post.metadata?.location === 'string' &&
                    typeof post.metadata?.employmentType === 'string'
                  "
                >
                  ·
                </span>
                <span v-if="typeof post.metadata?.employmentType === 'string'">{{
                  post.metadata?.employmentType
                }}</span>
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <Badge v-if="post.state === 'archived'" variant="secondary">{{
                copy("archived")
              }}</Badge>
              <Badge variant="outline"
                >{{ post.sourceKind }} · {{ copy("version") }} {{ post.versionNumber }}</Badge
              >
            </div></CardHeader
          ><CardContent class="flex gap-2"
            ><Button as-child variant="secondary"
              ><RouterLink :to="`/jobs/${post.id}/overview`"
                ><Sparkles />{{ copy("prepare") }}</RouterLink
              ></Button
            ><Button
              :disabled="
                post.state !== 'active' ||
                startingPostIds.has(post.id) ||
                activeApplicationPostIds.has(post.id)
              "
              @click="startApplication(post)"
              ><BriefcaseBusiness />{{
                activeApplicationPostIds.has(post.id)
                  ? copy("applicationInProgress")
                  : copy("startApplication")
              }}</Button
            ><Button variant="outline" @click="showVersions(post)"
              ><History />{{ copy("versionHistory") }}</Button
            ><Button v-if="post.state === 'active'" variant="ghost" @click="archivePosting(post)"
              ><Archive />{{ copy("archive") }}</Button
            ></CardContent
          ></Card
        >
      </div>
    </section>

    <Card v-if="activePost">
      <CardHeader>
        <CardTitle>{{ activePost.title }} · {{ copy("versionHistory") }}</CardTitle>
      </CardHeader>
      <CardContent class="grid gap-5 lg:grid-cols-2">
        <div class="grid gap-3">
          <Label>{{ copy("versionSource") }}</Label>
          <Select v-model="versionSource" :disabled="activePost.state !== 'active'">
            <SelectTrigger class="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">{{ copy("manual") }}</SelectItem>
              <SelectItem value="file">{{ copy("file") }}</SelectItem>
              <SelectItem value="url">{{ copy("url") }}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            v-if="versionSource === 'url'"
            v-model="updateUrl"
            type="url"
            :disabled="activePost.state !== 'active'"
            :aria-label="copy('updateUrl')"
          />
          <textarea
            v-else-if="versionSource === 'manual'"
            v-model="versionBody"
            class="min-h-28 rounded-lg border bg-background p-3"
            :disabled="activePost.state !== 'active'"
            :placeholder="copy('body')"
          />
          <Input
            v-else
            type="file"
            accept=".pdf,.docx,.md,.txt"
            :disabled="activePost.state !== 'active'"
            :aria-label="copy('versionFile')"
            @change="versionFile = ($event.target as HTMLInputElement).files?.[0] ?? null"
          />
          <Button
            class="w-fit"
            :disabled="
              updatingPost ||
              activePost.state !== 'active' ||
              (versionSource === 'url' && !updateUrl.trim()) ||
              (versionSource === 'manual' && !versionBody.trim()) ||
              (versionSource === 'file' && versionFile === null)
            "
            @click="addPostingVersion"
          >
            <RefreshCw />{{ copy("addVersion") }}
          </Button>
          <p class="text-sm text-muted-foreground">{{ copy("versionHelp") }}</p>
        </div>
        <ol class="grid gap-2 text-sm">
          <li
            v-for="version in postingVersions"
            :key="version.id"
            class="flex items-center justify-between gap-3 rounded border p-3"
          >
            <span
              >{{ copy("version") }} {{ version.versionNumber }} ·
              {{ copy(version.sourceKind) }}</span
            >
            <time :datetime="version.createdAt">{{
              new Date(version.createdAt).toLocaleString(settings.locale)
            }}</time>
          </li>
        </ol>
      </CardContent>
    </Card>

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
              <div class="mt-1 flex items-center gap-2">
                <p class="text-sm text-muted-foreground">{{ application.stageName }}</p>
                <Badge v-if="application.archivedAt" variant="secondary">{{
                  copy("archived")
                }}</Badge>
              </div>
            </div>
            <Select
              v-model="selectedStages[application.id]"
              :disabled="application.archivedAt !== null"
              ><SelectTrigger class="w-48"><SelectValue /></SelectTrigger
              ><SelectContent
                ><SelectItem v-for="stage in stages" :key="stage.id" :value="stage.id">{{
                  stage.name
                }}</SelectItem></SelectContent
              ></Select
            ><Button
              variant="secondary"
              :disabled="application.archivedAt !== null"
              @click="move(application)"
              >{{ copy("move") }}</Button
            ><Button variant="outline" @click="showHistory(application.id)"
              ><History />{{ copy("history") }}</Button
            ><Button
              v-if="application.archivedAt === null"
              variant="ghost"
              @click="archiveApplication(application)"
              ><Archive />{{ copy("archiveApplication") }}</Button
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
          <div class="grid gap-2 sm:grid-cols-2">
            <Input v-model="interviewAt" type="datetime-local" /><Input
              v-model="interviewKind"
              :placeholder="copy('interviewKind')"
            />
            <Input v-model="interviewLocation" :placeholder="copy('interviewLocation')" />
            <Input v-model="interviewNotes" :placeholder="copy('interviewNotes')" />
            <Button
              class="w-fit"
              :disabled="!interviewAt || !interviewKind.trim()"
              @click="schedule"
              ><CalendarPlus />{{ copy("scheduleInterview") }}</Button
            >
          </div>
        </div>
        <ol class="grid gap-2 text-sm">
          <li v-for="event in history" :key="event.id" class="rounded border p-3">
            <p class="font-medium">
              #{{ event.sequence }} {{ eventTitle(event) }} ·
              {{ new Date(event.createdAt).toLocaleString(settings.locale) }}
            </p>
            <p v-if="eventDetail(event)" class="mt-1 whitespace-pre-wrap text-muted-foreground">
              {{ eventDetail(event) }}
            </p>
          </li>
          <li v-for="interview in interviews" :key="interview.id" class="rounded border p-3">
            <p class="font-medium">
              {{ interview.kind }} ·
              {{ new Date(interview.scheduledAt).toLocaleString(settings.locale) }}
            </p>
            <p v-if="interview.location" class="mt-1 text-muted-foreground">
              {{ copy("interviewLocation") }} · {{ interview.location }}
            </p>
            <p v-if="interview.notes" class="mt-1 whitespace-pre-wrap text-muted-foreground">
              {{ interview.notes }}
            </p>
          </li>
        </ol></CardContent
      ></Card
    >

    <Card
      ><CardHeader
        ><CardTitle>{{ copy("stages") }}</CardTitle></CardHeader
      ><CardContent
        ><div class="grid gap-2">
          <div
            v-for="(stage, index) in stages"
            :key="stage.id"
            class="flex flex-wrap items-center gap-2 rounded-lg border p-2"
          >
            <span class="w-6 text-center text-sm text-muted-foreground">{{ stage.position }}</span>
            <Input v-model="stageNames[stage.id]" class="min-w-48 flex-1" />
            <Button
              size="icon"
              variant="ghost"
              :aria-label="`${copy('moveStageUp')}: ${stage.name}`"
              :disabled="index === 0"
              @click="moveStage(stage, -1)"
              ><ArrowUp
            /></Button>
            <Button
              size="icon"
              variant="ghost"
              :aria-label="`${copy('moveStageDown')}: ${stage.name}`"
              :disabled="index === stages.length - 1"
              @click="moveStage(stage, 1)"
              ><ArrowDown
            /></Button>
            <Button
              size="icon"
              variant="ghost"
              :aria-label="`${copy('saveStage')}: ${stage.name}`"
              :disabled="!stageNames[stage.id]?.trim() || stageNames[stage.id] === stage.name"
              @click="renameStage(stage)"
              ><Save
            /></Button>
            <Button
              v-if="!stage.system"
              size="icon"
              variant="ghost"
              :aria-label="`${copy('deleteStage')}: ${stage.name}`"
              @click="deleteStage(stage)"
              ><Trash2
            /></Button>
          </div>
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
