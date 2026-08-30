<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { Building2, ExternalLink, Radar, Save, Sparkles } from "lucide-vue-next"
import { toast } from "vue-sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { translate } from "../locales"
import { useSettingsStore } from "../stores/settings"

type Platform = "wanted" | "saramin" | "jobkorea" | "remember" | "greeting" | "inthiswork"
type Document = {
  id: string
  title: string
  kind: string
  state: string
  selected: boolean
  currentVersionId: string | null
}
type Posting = { id: string; canonicalUrl: string | null }
type Recommendation = {
  title: string
  company: string
  url: string
  platform: string
  location: string | null
  experience: string | null
  companySize: string | null
  summary: string
  score: number
  breakdown: { profile: number; criteria: number; freshness: number }
  matchedSkills: string[]
  gaps: string[]
  rationale: string
}

const settings = useSettingsStore()
const copy = (key: string) => translate(settings.locale, `jobSearch.${key}`)
const controller = new AbortController()
const roles = ref("")
const skills = ref("")
const industries = ref("")
const companySizes = ref("")
const locations = ref("")
const experience = ref("")
const documents = ref<Document[]>([])
const selectedDocumentVersionIds = ref<string[]>([])
const platforms = ref<Platform[]>([
  "wanted",
  "saramin",
  "jobkorea",
  "remember",
  "greeting",
  "inthiswork"
])
const recommendations = ref<Recommendation[]>([])
const savedUrls = ref(new Set<string>())
const running = ref(false)
const savingUrl = ref<string | null>(null)
const platformOptions: Array<[Platform, string]> = [
  ["wanted", "원티드"],
  ["saramin", "사람인"],
  ["jobkorea", "잡코리아"],
  ["remember", "리멤버"],
  ["greeting", "그리팅"],
  ["inthiswork", "인디스워크"]
]
const values = (text: string) =>
  text
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean)
const ready = computed(() => values(roles.value).length > 0 && platforms.value.length > 0)
const csrf = async () =>
  ((await (await fetch("/api/security/csrf")).json()) as { csrfToken: string }).csrfToken
const load = async () => {
  const [documentsResponse, postingsResponse] = await Promise.all([
    fetch("/api/documents", { signal: controller.signal }),
    fetch("/api/postings", { signal: controller.signal })
  ])
  if (!documentsResponse.ok || !postingsResponse.ok) throw new Error("request")
  const documentBody = (await documentsResponse.json()) as { documents: Document[] }
  const postingBody = (await postingsResponse.json()) as { postings: Posting[] }
  documents.value = documentBody.documents.filter(
    (document) => document.state === "active" && document.currentVersionId !== null
  )
  selectedDocumentVersionIds.value = documents.value
    .filter((document) => document.selected)
    .flatMap((document) => (document.currentVersionId === null ? [] : [document.currentVersionId]))
  savedUrls.value = new Set(
    postingBody.postings.flatMap((posting) =>
      posting.canonicalUrl === null ? [] : [posting.canonicalUrl]
    )
  )
}
const togglePlatform = (platform: Platform) => {
  platforms.value = platforms.value.includes(platform)
    ? platforms.value.filter((item) => item !== platform)
    : [...platforms.value, platform]
}
const toggleDocument = (versionId: string) => {
  selectedDocumentVersionIds.value = selectedDocumentVersionIds.value.includes(versionId)
    ? selectedDocumentVersionIds.value.filter((id) => id !== versionId)
    : [...selectedDocumentVersionIds.value, versionId]
}
const discover = async () => {
  if (!ready.value || running.value) return
  running.value = true
  recommendations.value = []
  try {
    const response = await fetch("/api/job-search/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": await csrf() },
      body: JSON.stringify({
        roles: values(roles.value),
        skills: values(skills.value),
        industries: values(industries.value),
        companySizes: values(companySizes.value),
        locations: values(locations.value),
        experience: experience.value.trim(),
        platforms: platforms.value,
        documentVersionIds: selectedDocumentVersionIds.value
      })
    })
    if (!response.ok) throw new Error("request")
    recommendations.value = (
      (await response.json()) as { recommendations: Recommendation[] }
    ).recommendations
  } catch {
    toast.error(copy("discoverFailed"))
  } finally {
    running.value = false
  }
}
const save = async (item: Recommendation) => {
  if (savingUrl.value !== null || savedUrls.value.has(item.url)) return
  savingUrl.value = item.url
  try {
    const response = await fetch("/api/postings/url", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": await csrf() },
      body: JSON.stringify({
        url: item.url,
        title: item.title,
        companyName: item.company,
        teamName: null,
        location: item.location,
        employmentType: null
      })
    })
    if (!response.ok) throw new Error("request")
    savedUrls.value = new Set([...savedUrls.value, item.url])
    toast.success(copy("saved"))
  } catch {
    toast.error(copy("saveFailed"))
  } finally {
    savingUrl.value = null
  }
}
onMounted(() => void load().catch(() => toast.error(copy("loadFailed"))))
onBeforeUnmount(() => controller.abort())
</script>

<template>
  <div class="grid gap-10">
    <section>
      <p class="eyebrow">{{ copy("overline") }}</p>
      <h1 class="page-title mt-5">{{ copy("title") }}</h1>
      <p class="route-copy mt-4">{{ copy("copy") }}</p>
    </section>
    <Card class="relative overflow-hidden">
      <div
        class="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-primary/10 blur-3xl"
      />
      <CardHeader
        ><CardTitle class="flex items-center gap-2"
          ><Radar class="text-primary" />{{ copy("criteria") }}</CardTitle
        ></CardHeader
      >
      <CardContent class="relative grid gap-6">
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div class="grid gap-2">
            <Label for="search-roles">{{ copy("roles") }}</Label
            ><Input id="search-roles" v-model="roles" :placeholder="copy('rolesPlaceholder')" />
          </div>
          <div class="grid gap-2">
            <Label for="search-skills">{{ copy("skills") }}</Label
            ><Input id="search-skills" v-model="skills" :placeholder="copy('skillsPlaceholder')" />
          </div>
          <div class="grid gap-2">
            <Label for="search-industries">{{ copy("industries") }}</Label
            ><Input id="search-industries" v-model="industries" />
          </div>
          <div class="grid gap-2">
            <Label for="search-sizes">{{ copy("companySizes") }}</Label
            ><Input
              id="search-sizes"
              v-model="companySizes"
              :placeholder="copy('sizesPlaceholder')"
            />
          </div>
          <div class="grid gap-2">
            <Label for="search-locations">{{ copy("locations") }}</Label
            ><Input id="search-locations" v-model="locations" />
          </div>
          <div class="grid gap-2">
            <Label for="search-experience">{{ copy("experience") }}</Label
            ><Input
              id="search-experience"
              v-model="experience"
              :placeholder="copy('experiencePlaceholder')"
            />
          </div>
        </div>
        <div class="grid gap-3">
          <Label>{{ copy("platforms") }}</Label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="[value, label] in platformOptions"
              :key="value"
              type="button"
              class="min-h-11 rounded-full border px-4 text-sm transition-all"
              :class="
                platforms.includes(value)
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'hover:border-primary/40'
              "
              @click="togglePlatform(value)"
            >
              {{ label }}
            </button>
          </div>
        </div>
        <div class="grid gap-3">
          <Label>{{ copy("profileDocuments") }}</Label>
          <div class="grid gap-2 md:grid-cols-2">
            <label
              v-for="document in documents"
              :key="document.id"
              class="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border p-3 hover:border-primary/30"
              ><input
                type="checkbox"
                :checked="selectedDocumentVersionIds.includes(document.currentVersionId!)"
                @change="toggleDocument(document.currentVersionId!)"
              /><span
                ><strong>{{ document.title }}</strong
                ><small class="ml-2 text-muted-foreground">{{ document.kind }}</small></span
              ></label
            >
          </div>
        </div>
        <Button size="lg" class="w-fit" :disabled="!ready || running" @click="discover"
          ><Sparkles />{{ running ? copy("discovering") : copy("discover") }}</Button
        >
      </CardContent>
    </Card>
    <section v-if="recommendations.length" class="grid gap-5">
      <div>
        <p class="eyebrow">MATCHED / {{ recommendations.length }}</p>
        <h2 class="mt-4 text-3xl font-semibold">{{ copy("recommendations") }}</h2>
      </div>
      <Card v-for="item in recommendations" :key="item.url"
        ><CardContent class="grid gap-5 py-6 lg:grid-cols-[auto_1fr_auto]">
          <div
            class="grid size-20 place-items-center rounded-2xl bg-gradient-to-br from-primary to-[#4d7cff] text-2xl font-bold text-white shadow-[0_8px_24px_rgb(0_82_255/0.3)]"
          >
            {{ item.score }}
          </div>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <Badge>{{ item.platform }}</Badge
              ><Badge v-if="item.companySize" variant="outline">{{ item.companySize }}</Badge
              ><span class="text-sm text-muted-foreground"
                >{{ item.location }} · {{ item.experience }}</span
              >
            </div>
            <a
              :href="item.url"
              target="_blank"
              rel="noreferrer"
              class="mt-3 inline-flex items-center gap-2 text-xl font-semibold hover:text-primary"
              >{{ item.title }}<ExternalLink class="size-4"
            /></a>
            <p class="mt-1 text-sm font-medium">{{ item.company }}</p>
            <p class="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{{ item.summary }}</p>
            <p class="mt-3 text-sm">{{ item.rationale }}</p>
            <div class="mt-4 flex flex-wrap gap-2">
              <Badge v-for="skill in item.matchedSkills" :key="skill" variant="secondary">{{
                skill
              }}</Badge
              ><Badge v-for="gap in item.gaps" :key="gap" variant="outline">GAP · {{ gap }}</Badge>
            </div>
            <div class="mt-4 flex gap-4 font-mono text-xs text-muted-foreground">
              <span>PROFILE {{ item.breakdown.profile }}</span
              ><span>CRITERIA {{ item.breakdown.criteria }}</span
              ><span>FRESH {{ item.breakdown.freshness }}</span>
            </div>
          </div>
          <Button :disabled="savingUrl !== null || savedUrls.has(item.url)" @click="save(item)"
            ><Save />{{ savedUrls.has(item.url) ? copy("savedAlready") : copy("save") }}</Button
          >
        </CardContent></Card
      >
    </section>
    <Card v-else-if="!running"
      ><CardContent class="flex flex-col items-center py-12 text-center"
        ><Building2 class="size-10 text-primary" />
        <p class="mt-4 font-medium">{{ copy("empty") }}</p>
        <p class="mt-2 text-sm text-muted-foreground">{{ copy("emptyHelp") }}</p></CardContent
      ></Card
    >
  </div>
</template>
