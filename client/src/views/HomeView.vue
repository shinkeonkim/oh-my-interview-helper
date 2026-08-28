<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { RouterLink } from "vue-router"
import { ArrowRight, BriefcaseBusiness, FileText, ListChecks } from "lucide-vue-next"
import { toast } from "vue-sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { translate } from "../locales"
import { useSettingsStore } from "../stores/settings"

type Posting = { id: string; title: string; companyName: string }
type Application = { id: string; jobPostId: string; stageName: string; appliedAt: string | null }
type Document = { id: string; title: string; state: string }

const settings = useSettingsStore()
const copy = (key: string): string => translate(settings.locale, key)
const controller = new AbortController()
const postings = ref<Posting[]>([])
const applications = ref<Application[]>([])
const documents = ref<Document[]>([])
const loading = ref(true)
const activeDocuments = computed(() => documents.value.filter((item) => item.state === "active"))
const focusApplication = computed(
  () =>
    [...applications.value].sort(
      (left, right) => Date.parse(right.appliedAt ?? "") - Date.parse(left.appliedAt ?? "")
    )[0]
)
const focusPosting = computed(
  () =>
    postings.value.find((item) => item.id === focusApplication.value?.jobPostId) ??
    postings.value[0]
)
const hasRecords = computed(
  () =>
    postings.value.length > 0 || applications.value.length > 0 || activeDocuments.value.length > 0
)
const load = async () => {
  loading.value = true
  try {
    const [postingsResponse, applicationsResponse, documentsResponse] = await Promise.all([
      fetch("/api/postings", { signal: controller.signal }),
      fetch("/api/applications", { signal: controller.signal }),
      fetch("/api/documents", { signal: controller.signal })
    ])
    if (![postingsResponse, applicationsResponse, documentsResponse].every((item) => item.ok))
      throw new Error("request")
    const postingsBody = (await postingsResponse.json()) as { postings?: unknown }
    const applicationsBody = (await applicationsResponse.json()) as { applications?: unknown }
    const documentsBody = (await documentsResponse.json()) as { documents?: unknown }
    if (
      !Array.isArray(postingsBody.postings) ||
      !Array.isArray(applicationsBody.applications) ||
      !Array.isArray(documentsBody.documents)
    )
      throw new Error("response")
    postings.value = postingsBody.postings as Posting[]
    applications.value = applicationsBody.applications as Application[]
    documents.value = documentsBody.documents as Document[]
  } catch {
    toast.error(copy("home.failed"))
  } finally {
    loading.value = false
  }
}
onMounted(() => void load())
onBeforeUnmount(() => controller.abort())
</script>

<template>
  <div class="grid gap-10 lg:gap-14">
    <section aria-labelledby="home-title" class="max-w-3xl">
      <p class="eyebrow">{{ copy("home.overline") }}</p>
      <h1
        id="home-title"
        class="mt-4 max-w-3xl whitespace-pre-line text-4xl font-bold tracking-tight sm:text-5xl"
        style="word-break: keep-all; text-wrap: pretty"
      >
        {{ copy("home.title") }}
      </h1>
      <p class="route-copy mt-5">{{ copy("home.intro") }}</p>
      <div class="mt-7 flex flex-wrap gap-3">
        <Button as-child
          ><RouterLink to="/documents"
            >{{ copy("home.primary") }}<ArrowRight aria-hidden="true" /></RouterLink></Button
        ><Button as-child variant="outline"
          ><RouterLink to="/jobs">{{ copy("home.secondary") }}</RouterLink></Button
        >
      </div>
    </section>

    <section class="grid gap-4 sm:grid-cols-3" :aria-label="copy('home.summary')">
      <Card
        ><CardHeader
          ><CardTitle class="flex items-center gap-2 text-base"
            ><BriefcaseBusiness />{{ copy("home.postings") }}</CardTitle
          ></CardHeader
        ><CardContent
          ><p class="text-3xl font-semibold">{{ loading ? "-" : postings.length }}</p></CardContent
        ></Card
      >
      <Card
        ><CardHeader
          ><CardTitle class="flex items-center gap-2 text-base"
            ><ListChecks />{{ copy("home.applications") }}</CardTitle
          ></CardHeader
        ><CardContent
          ><p class="text-3xl font-semibold">
            {{ loading ? "-" : applications.length }}
          </p></CardContent
        ></Card
      >
      <Card
        ><CardHeader
          ><CardTitle class="flex items-center gap-2 text-base"
            ><FileText />{{ copy("home.documents") }}</CardTitle
          ></CardHeader
        ><CardContent
          ><p class="text-3xl font-semibold">
            {{ loading ? "-" : activeDocuments.length }}
          </p></CardContent
        ></Card
      >
    </section>

    <section class="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]" :aria-label="copy('home.focusTitle')">
      <Card class="border-l-4 border-l-primary">
        <CardHeader class="flex-row items-start justify-between gap-4"
          ><div>
            <p class="eyebrow">{{ copy("home.focusMeta") }}</p>
            <CardTitle class="mt-3 text-2xl">{{
              focusPosting?.title ?? copy("home.focusTitle")
            }}</CardTitle>
          </div>
          <Badge :variant="focusApplication ? 'secondary' : 'outline'">{{
            focusApplication?.stageName ?? copy("states.empty")
          }}</Badge></CardHeader
        >
        <CardContent>
          <template v-if="focusPosting"
            ><p class="text-sm font-medium">{{ focusPosting.companyName }}</p>
            <p class="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              {{ focusApplication ? copy("home.applicationFocus") : copy("home.postingFocus") }}
            </p>
            <Button as-child variant="link" class="mt-5 h-auto px-0"
              ><RouterLink :to="`/jobs/${focusPosting.id}/overview`"
                >{{ copy("home.continue") }}<ArrowRight aria-hidden="true" /></RouterLink></Button
          ></template>
          <template v-else
            ><p class="max-w-xl text-sm leading-6 text-muted-foreground">
              {{ copy("home.focusCopy") }}
            </p>
            <Button as-child variant="link" class="mt-5 h-auto px-0"
              ><RouterLink to="/jobs"
                >{{ copy("home.addPosting") }}<ArrowRight aria-hidden="true" /></RouterLink></Button
          ></template>
        </CardContent>
      </Card>
      <Card class="bg-muted/45"
        ><CardHeader
          ><CardTitle class="text-xl">{{ copy("home.nextTitle") }}</CardTitle></CardHeader
        ><CardContent
          ><p class="text-sm leading-6 text-muted-foreground">
            {{ hasRecords ? copy("home.nextCopy") : copy("home.noteCopy") }}
          </p>
          <Button as-child variant="link" class="mt-4 h-auto px-0"
            ><RouterLink :to="activeDocuments.length ? '/search' : '/documents'"
              >{{ activeDocuments.length ? copy("nav.search") : copy("home.primary")
              }}<ArrowRight aria-hidden="true" /></RouterLink></Button></CardContent
      ></Card>
    </section>
  </div>
</template>
