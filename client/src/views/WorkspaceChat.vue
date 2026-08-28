<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
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

type Document = {
  id: string
  title: string
  state: string
  currentVersionId: string | null
  versionNumber: number | null
}
type Provider = { id: string; model: { displayName: string }; configured: boolean }
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

const props = defineProps<{
  applicationId: string
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
const documentVersionId = ref("none")
const message = ref("")
const turnKey = ref(crypto.randomUUID())
const preview = ref<{ manifest: Manifest; authorizationToken: string } | null>(null)
const running = ref(false)
const inputs = computed(() => {
  const selected: Array<Record<string, string>> = [
    { kind: "job_post_version", jobPostVersionId: props.postingVersionId }
  ]
  if (documentVersionId.value !== "none")
    selected.push({ kind: "document_version", documentVersionId: documentVersionId.value })
  return selected
})
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
const loadMessages = async (id: string) => {
  const response = await fetch(`/api/conversations/${id}/messages`, {
    signal: controller.signal
  })
  if (response.ok) messages.value = ((await response.json()) as { messages: Message[] }).messages
}
const load = async () => {
  const [documentsResponse, providersResponse, conversationsResponse] = await Promise.all([
    fetch("/api/documents", { signal: controller.signal }),
    fetch("/api/providers/status", { signal: controller.signal }),
    fetch(`/api/conversations?applicationId=${encodeURIComponent(props.applicationId)}`, {
      signal: controller.signal
    })
  ])
  documents.value = (
    (await documentsResponse.json()) as { documents: Document[] }
  ).documents.filter((item) => item.state === "active" && item.currentVersionId)
  providers.value = (
    (await providersResponse.json()) as { providers: Provider[] }
  ).providers.filter((item) => item.configured)
  conversations.value = (
    (await conversationsResponse.json()) as { conversations: Conversation[] }
  ).conversations
  providerId.value = providers.value[0]?.id ?? ""
  const latest = conversations.value.at(-1)
  if (latest) {
    conversationId.value = latest.id
    await loadMessages(latest.id)
  }
}
const review = async () => {
  if (!message.value.trim()) return
  try {
    preview.value = (await (await post("/api/conversations/preview", requestBody())).json()) as {
      manifest: Manifest
      authorizationToken: string
    }
  } catch {
    toast.error(copy("failed"))
  }
}
const send = async () => {
  if (!preview.value) return
  running.value = true
  try {
    const confirmation = (await (
      await post("/api/disclosures/confirm", {
        authorizationToken: preview.value.authorizationToken
      })
    ).json()) as { id: string }
    const result = (await (
      await post("/api/conversations/send", {
        ...requestBody(),
        disclosureId: confirmation.id
      })
    ).json()) as { conversation: Conversation; messages: Message[] }
    conversationId.value = result.conversation.id
    messages.value.push(...result.messages)
    if (!conversations.value.some((item) => item.id === result.conversation.id))
      conversations.value.push(result.conversation)
    message.value = ""
    preview.value = null
    turnKey.value = crypto.randomUUID()
  } catch {
    toast.error(copy("failed"))
  } finally {
    running.value = false
  }
}
onMounted(() => void load().catch(() => toast.error(copy("failed"))))
onBeforeUnmount(() => controller.abort())
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
          <p class="mt-3 whitespace-pre-wrap text-sm">
            {{ item.content.text ?? item.content.answer }}
          </p>
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
      <div class="grid gap-4 md:grid-cols-2">
        <div class="grid gap-2">
          <Label for="chat-provider">{{ copy("provider") }}</Label
          ><select
            id="chat-provider"
            v-model="providerId"
            class="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option v-for="provider in providers" :key="provider.id" :value="provider.id">
              {{ provider.id }} · {{ provider.model.displayName }}
            </option>
          </select>
        </div>
        <div class="grid gap-2">
          <Label for="chat-document">{{ copy("document") }}</Label
          ><select
            id="chat-document"
            v-model="documentVersionId"
            class="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="none">{{ copy("noDocument") }}</option>
            <option
              v-for="document in documents"
              :key="document.id"
              :value="document.currentVersionId!"
            >
              {{ document.title }} · v{{ document.versionNumber }}
            </option>
          </select>
        </div>
      </div>
      <div class="grid gap-2">
        <Label for="chat-message">{{ copy("message") }}</Label
        ><Textarea id="chat-message" v-model="message" :placeholder="copy('placeholder')" />
      </div>
      <Button class="w-fit" :disabled="!providerId || !message.trim()" @click="review"
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
    <DialogContent>
      <DialogHeader
        ><DialogTitle>{{ copy("disclosureTitle") }}</DialogTitle
        ><DialogDescription>{{ copy("disclosureCopy") }}</DialogDescription></DialogHeader
      >
      <div v-if="preview" class="grid gap-3 text-sm">
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
