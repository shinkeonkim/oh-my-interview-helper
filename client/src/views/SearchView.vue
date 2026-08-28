<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { RouterLink } from "vue-router"
import { BriefcaseBusiness, FileText, Search, Telescope } from "lucide-vue-next"
import { toast } from "vue-sonner"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { translate } from "../locales"
import { useSettingsStore } from "../stores/settings"

type Posting = { id: string; title: string; companyName: string; teamName: string | null }
type Document = { id: string; title: string; kind: string; state: string }
type Research = { id: string; subjectName: string; subjectType: string; createdAt: string }
type Result = {
  id: string
  type: "posting" | "document" | "research"
  title: string
  description: string
  to: string
}

const settings = useSettingsStore()
const copy = (key: string) => translate(settings.locale, `search.${key}`)
const controller = new AbortController()
const query = ref("")
const postings = ref<Posting[]>([])
const documents = ref<Document[]>([])
const research = ref<Research[]>([])
const normalizedQuery = computed(() => query.value.trim().toLocaleLowerCase(settings.locale))
const results = computed<Result[]>(() => {
  if (!normalizedQuery.value) return []
  const includes = (...values: Array<string | null>) =>
    values.some((value) =>
      value?.toLocaleLowerCase(settings.locale).includes(normalizedQuery.value)
    )
  return [
    ...postings.value
      .filter((item) => includes(item.title, item.companyName, item.teamName))
      .map((item) => ({
        id: item.id,
        type: "posting" as const,
        title: item.title,
        description: [item.companyName, item.teamName].filter(Boolean).join(" · "),
        to: `/jobs/${item.id}/overview`
      })),
    ...documents.value
      .filter((item) => item.state === "active" && includes(item.title, item.kind))
      .map((item) => ({
        id: item.id,
        type: "document" as const,
        title: item.title,
        description: item.kind,
        to: "/documents"
      })),
    ...research.value
      .filter((item) => includes(item.subjectName, item.subjectType))
      .map((item) => ({
        id: item.id,
        type: "research" as const,
        title: item.subjectName,
        description: item.subjectType,
        to: "/research"
      }))
  ]
})
const icon = (type: Result["type"]) =>
  type === "posting" ? BriefcaseBusiness : type === "document" ? FileText : Telescope
const loadResearch = async (postIds: string[]) => {
  const responses = await Promise.all(
    [null, ...postIds].map((postId) =>
      fetch(
        postId === null ? "/api/research" : `/api/research?jobPostId=${encodeURIComponent(postId)}`,
        { signal: controller.signal }
      )
    )
  )
  if (!responses.every((response) => response.ok)) throw new Error("request")
  const groups = await Promise.all(
    responses.map(async (response) => ((await response.json()) as { records: Research[] }).records)
  )
  const unique = new Map(groups.flat().map((item) => [item.id, item]))
  research.value = [...unique.values()]
}
const load = async () => {
  const [postingsResponse, documentsResponse] = await Promise.all([
    fetch("/api/postings", { signal: controller.signal }),
    fetch("/api/documents", { signal: controller.signal })
  ])
  if (!postingsResponse.ok || !documentsResponse.ok) throw new Error("request")
  const postingsBody = (await postingsResponse.json()) as { postings?: unknown }
  const documentsBody = (await documentsResponse.json()) as { documents?: unknown }
  if (!Array.isArray(postingsBody.postings) || !Array.isArray(documentsBody.documents))
    throw new Error("response")
  postings.value = postingsBody.postings as Posting[]
  documents.value = documentsBody.documents as Document[]
  await loadResearch(postings.value.map((item) => item.id))
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
    <div class="relative max-w-2xl">
      <Search
        class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        v-model="query"
        type="search"
        class="h-11 pl-10"
        :placeholder="copy('placeholder')"
        :aria-label="copy('input')"
        autofocus
      />
    </div>
    <p v-if="!normalizedQuery" class="text-sm text-muted-foreground">{{ copy("hint") }}</p>
    <p v-else-if="results.length === 0" class="text-sm text-muted-foreground">
      {{ copy("empty") }}
    </p>
    <section v-else class="grid gap-3" aria-live="polite" :aria-label="copy('results')">
      <RouterLink
        v-for="result in results"
        :key="`${result.type}-${result.id}`"
        :to="result.to"
        class="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Card class="transition-colors hover:bg-muted/40"
          ><CardContent class="flex items-center gap-4 py-4"
            ><component :is="icon(result.type)" class="size-5 shrink-0 text-muted-foreground" />
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">{{ result.title }}</p>
              <p class="truncate text-sm text-muted-foreground">{{ result.description }}</p>
            </div>
            <Badge variant="outline">{{ copy(`type.${result.type}`) }}</Badge></CardContent
          ></Card
        >
      </RouterLink>
    </section>
  </div>
</template>
