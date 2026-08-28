<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue"
import { ExternalLink, Save, Search } from "lucide-vue-next"
import { toast } from "vue-sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { translate } from "../locales"
import { useSettingsStore } from "../stores/settings"

type Preview = { url: string; text: string; contentType: string }
type Posting = {
  id: string
  title: string
  companyName: string
  teamName: string | null
  canonicalUrl: string | null
  sourceKind: string
}

const settings = useSettingsStore()
const copy = (key: string) => translate(settings.locale, `jobSearch.${key}`)
const controller = new AbortController()
const url = ref("")
const title = ref("")
const company = ref("")
const team = ref("")
const preview = ref<Preview | null>(null)
const postings = ref<Posting[]>([])
const previewing = ref(false)
const saving = ref(false)
const csrf = async () =>
  ((await (await fetch("/api/security/csrf")).json()) as { csrfToken: string }).csrfToken
const load = async () => {
  const response = await fetch("/api/postings", { signal: controller.signal })
  if (!response.ok) throw new Error("request")
  const body = (await response.json()) as { postings?: unknown }
  if (!Array.isArray(body.postings)) throw new Error("response")
  postings.value = body.postings as Posting[]
}
const inspect = async () => {
  previewing.value = true
  preview.value = null
  try {
    const response = await fetch("/api/preview/url", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": await csrf() },
      body: JSON.stringify({ url: url.value })
    })
    if (!response.ok) throw new Error("request")
    preview.value = (await response.json()) as Preview
  } catch {
    toast.error(copy("previewFailed"))
  } finally {
    previewing.value = false
  }
}
const save = async () => {
  if (preview.value === null) return
  saving.value = true
  try {
    const response = await fetch("/api/postings/url", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": await csrf() },
      body: JSON.stringify({
        url: preview.value.url,
        title: title.value,
        companyName: company.value,
        teamName: team.value || null,
        location: null,
        employmentType: null
      })
    })
    if (!response.ok) throw new Error("request")
    url.value = title.value = company.value = team.value = ""
    preview.value = null
    await load()
    toast.success(copy("saved"))
  } catch {
    toast.error(copy("saveFailed"))
  } finally {
    saving.value = false
  }
}
onMounted(() => void load().catch(() => toast.error(copy("loadFailed"))))
onBeforeUnmount(() => controller.abort())
</script>

<template>
  <div class="grid gap-8">
    <section>
      <p class="eyebrow">{{ copy("overline") }}</p>
      <h1 class="page-title mt-4">{{ copy("title") }}</h1>
      <p class="route-copy mt-4">{{ copy("copy") }}</p>
    </section>
    <Card class="max-w-4xl">
      <CardHeader
        ><CardTitle>{{ copy("inspectTitle") }}</CardTitle></CardHeader
      >
      <CardContent class="grid gap-5">
        <div class="grid gap-2">
          <Label for="posting-url">{{ copy("url") }}</Label>
          <div class="flex flex-col gap-2 sm:flex-row">
            <Input
              id="posting-url"
              v-model="url"
              type="url"
              :placeholder="copy('urlPlaceholder')"
            />
            <Button :disabled="previewing || !url.trim()" @click="inspect">
              <Search />{{ copy("inspect") }}
            </Button>
          </div>
          <p class="text-sm text-muted-foreground">{{ copy("safety") }}</p>
        </div>
        <div v-if="preview" class="grid gap-4 rounded-xl border p-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <a
              :href="preview.url"
              target="_blank"
              rel="noreferrer"
              class="break-all text-sm text-primary underline"
            >
              {{ preview.url }} <ExternalLink class="inline size-3" />
            </a>
            <Badge variant="outline">{{ preview.contentType }}</Badge>
          </div>
          <p
            class="max-h-40 overflow-auto whitespace-pre-wrap text-sm leading-6 text-muted-foreground"
          >
            {{ preview.text }}
          </p>
          <div class="grid gap-4 md:grid-cols-3">
            <div class="grid gap-2">
              <Label>{{ copy("role") }}</Label
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
          <Button
            class="w-fit"
            :disabled="saving || !title.trim() || !company.trim()"
            @click="save"
          >
            <Save />{{ copy("save") }}
          </Button>
        </div>
      </CardContent>
    </Card>
    <section>
      <h2 class="text-xl font-semibold">{{ copy("savedTitle") }}</h2>
      <p v-if="postings.length === 0" class="mt-3 text-muted-foreground">{{ copy("empty") }}</p>
      <div v-else class="mt-4 grid gap-3 lg:grid-cols-2">
        <RouterLink
          v-for="posting in postings"
          :key="posting.id"
          :to="`/jobs/${posting.id}/overview`"
        >
          <Card class="h-full transition-colors hover:bg-muted/40"
            ><CardContent class="py-4">
              <p class="font-medium">{{ posting.title }}</p>
              <p class="mt-1 text-sm text-muted-foreground">
                {{ posting.companyName
                }}<span v-if="posting.teamName"> · {{ posting.teamName }}</span>
              </p>
            </CardContent></Card
          >
        </RouterLink>
      </div>
    </section>
  </div>
</template>
