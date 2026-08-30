<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { toast } from "vue-sonner"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { translate } from "../locales"
import { useSettingsStore, type Theme } from "../stores/settings"

const settings = useSettingsStore()
const copy = (key: string): string => translate(settings.locale, key)

const localeValue = computed({
  get: () => settings.locale,
  set: (value: string): void => {
    settings.setLocale(value === "en" ? "en" : "ko")
    toast.success(copy("settings.saved"))
  }
})

const themeValue = computed({
  get: () => settings.theme,
  set: (value: string): void => {
    const nextTheme: Theme = value === "light" || value === "dark" ? value : "system"
    settings.setTheme(nextTheme)
    toast.success(copy("settings.saved"))
  }
})

type Provider = {
  id: string
  mode: string
  model: { id: string; displayName: string }
  capabilities: Record<string, boolean>
  configured: boolean
}
type PairingCode = { code: string; expiresAt: string }
type Runner = {
  runnerName: string
  capabilities: {
    claudeVersion: string | null
    codexVersion: string | null
  }
  status: "active" | "revoked"
  lastSeenAt: string
}
const providers = ref<Provider[]>([])
const runners = ref<Runner[]>([])
const pairing = ref<PairingCode | null>(null)
const pendingProviderIds = ref<ReadonlySet<string>>(new Set())
const loadingProviders = ref(true)
const pairingBusy = ref(false)
const pendingRunnerNames = ref<ReadonlySet<string>>(new Set())
let providerLoadRequestId = 0
let runnerLoadRequestId = 0
let pairingRequestId = 0
let active = true
const csrf = async () =>
  ((await (await fetch("/api/security/csrf")).json()) as { csrfToken: string }).csrfToken
const loadProviders = async () => {
  const requestId = ++providerLoadRequestId
  loadingProviders.value = true
  try {
    const response = await fetch("/api/providers/status")
    if (!response.ok) throw new Error("request")
    const body = (await response.json()) as { providers?: unknown }
    if (!Array.isArray(body.providers)) throw new Error("response")
    if (requestId === providerLoadRequestId && active)
      providers.value = body.providers as Provider[]
  } catch {
    if (requestId === providerLoadRequestId && active) toast.error(copy("settings.providersFailed"))
  } finally {
    if (requestId === providerLoadRequestId && active) loadingProviders.value = false
  }
}
const setProvider = async (provider: Provider, enabled: boolean) => {
  if (pendingProviderIds.value.has(provider.id)) return
  pendingProviderIds.value = new Set([...pendingProviderIds.value, provider.id])
  try {
    const response = await fetch(`/api/settings/providers/${provider.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": await csrf() },
      body: JSON.stringify({
        selectedModel: enabled ? provider.model.id : null,
        enabled,
        capabilities: provider.capabilities
      })
    })
    if (!response.ok) throw new Error("request")
    await loadProviders()
    if (active) toast.success(copy("settings.providerSaved"))
  } catch {
    if (active) toast.error(copy("settings.providersFailed"))
  } finally {
    const next = new Set(pendingProviderIds.value)
    next.delete(provider.id)
    pendingProviderIds.value = next
  }
}
const issuePairingCode = async () => {
  if (pairingBusy.value) return
  const requestId = ++pairingRequestId
  pairingBusy.value = true
  pairing.value = null
  try {
    const response = await fetch("/api/runners/pairing-code", {
      method: "POST",
      headers: { "X-CSRF-Token": await csrf() }
    })
    if (!response.ok) throw new Error("request")
    const value = (await response.json()) as PairingCode
    if (requestId === pairingRequestId && active) pairing.value = value
  } catch {
    if (requestId === pairingRequestId && active) toast.error(copy("settings.pairingFailed"))
  } finally {
    if (requestId === pairingRequestId && active) pairingBusy.value = false
  }
}
const loadRunners = async () => {
  const requestId = ++runnerLoadRequestId
  try {
    const response = await fetch("/api/runners")
    if (!response.ok) throw new Error("request")
    const body = (await response.json()) as { runners?: unknown }
    if (!Array.isArray(body.runners)) throw new Error("response")
    if (requestId === runnerLoadRequestId && active) runners.value = body.runners as Runner[]
  } catch {
    if (requestId === runnerLoadRequestId && active) toast.error(copy("settings.runnersFailed"))
  }
}
const revokeRunner = async (runner: Runner) => {
  if (pendingRunnerNames.value.has(runner.runnerName)) return
  pendingRunnerNames.value = new Set([...pendingRunnerNames.value, runner.runnerName])
  try {
    const response = await fetch(`/api/runners/${encodeURIComponent(runner.runnerName)}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": await csrf() }
    })
    if (!response.ok) throw new Error("request")
    await loadRunners()
    if (active) toast.success(copy("settings.runnerRevoked"))
  } catch {
    if (active) toast.error(copy("settings.runnersFailed"))
  } finally {
    const next = new Set(pendingRunnerNames.value)
    next.delete(runner.runnerName)
    pendingRunnerNames.value = next
  }
}
onMounted(() => {
  void loadProviders()
  void loadRunners()
})
onBeforeUnmount(() => {
  active = false
  providerLoadRequestId += 1
  runnerLoadRequestId += 1
  pairingRequestId += 1
})
</script>

<template>
  <div class="grid gap-10">
    <section aria-labelledby="settings-title" class="max-w-3xl">
      <p class="eyebrow">{{ copy("settings.overline") }}</p>
      <h1 id="settings-title" class="page-title mt-4">{{ copy("settings.title") }}</h1>
      <p class="route-copy mt-4">{{ copy("settings.copy") }}</p>
    </section>

    <Card class="max-w-3xl">
      <CardHeader>
        <CardTitle>{{ copy("settings.preferences") }}</CardTitle>
        <CardDescription>{{ copy("settings.saved") }}</CardDescription>
      </CardHeader>
      <CardContent class="grid gap-6">
        <div class="grid gap-3 sm:grid-cols-[1fr_13rem] sm:items-center">
          <div>
            <Label for="locale-select">{{ copy("settings.language") }}</Label>
            <p id="locale-help" class="mt-1 text-sm leading-6 text-muted-foreground">
              {{ copy("settings.languageHelp") }}
            </p>
          </div>
          <Select v-model="localeValue">
            <SelectTrigger id="locale-select" aria-describedby="locale-help">
              <SelectValue :placeholder="copy('settings.language')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ko">한국어</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Separator />
        <div class="grid gap-3 sm:grid-cols-[1fr_13rem] sm:items-center">
          <div>
            <Label for="theme-select">{{ copy("settings.theme") }}</Label>
            <p id="theme-help" class="mt-1 text-sm leading-6 text-muted-foreground">
              {{ copy("settings.themeHelp") }}
            </p>
          </div>
          <Select v-model="themeValue">
            <SelectTrigger id="theme-select" aria-describedby="theme-help">
              <SelectValue :placeholder="copy('settings.theme')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">{{ copy("settings.system") }}</SelectItem>
              <SelectItem value="light">{{ copy("settings.light") }}</SelectItem>
              <SelectItem value="dark">{{ copy("settings.dark") }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>

    <Card class="max-w-3xl">
      <CardHeader>
        <CardTitle>{{ copy("settings.providers") }}</CardTitle>
        <CardDescription>{{ copy("settings.providersHelp") }}</CardDescription>
      </CardHeader>
      <CardContent>
        <p v-if="loadingProviders" class="text-sm text-muted-foreground">
          {{ copy("states.loading") }}
        </p>
        <p v-else-if="providers.length === 0" class="text-sm text-muted-foreground">
          {{ copy("settings.noProviders") }}
        </p>
        <ul v-else class="divide-y">
          <li
            v-for="provider in providers"
            :key="provider.id"
            class="flex flex-wrap items-center justify-between gap-4 py-4"
          >
            <div class="grid gap-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-medium">{{ provider.id }}</span>
                <Badge variant="outline">{{ provider.mode }}</Badge>
                <Badge :variant="provider.configured ? 'secondary' : 'outline'">
                  {{
                    provider.configured
                      ? copy("settings.providerEnabled")
                      : copy("settings.providerDisabled")
                  }}
                </Badge>
              </div>
              <p class="text-sm text-muted-foreground">
                {{ provider.model.displayName }} · {{ provider.model.id }}
              </p>
            </div>
            <Button
              :variant="provider.configured ? 'outline' : 'default'"
              :disabled="pendingProviderIds.has(provider.id)"
              @click="setProvider(provider, !provider.configured)"
            >
              {{
                provider.configured
                  ? copy("settings.disableProvider")
                  : copy("settings.enableProvider")
              }}
            </Button>
          </li>
        </ul>
      </CardContent>
    </Card>

    <Card class="max-w-3xl">
      <CardHeader>
        <CardTitle>{{ copy("settings.runner") }}</CardTitle>
        <CardDescription>{{ copy("settings.runnerHelp") }}</CardDescription>
      </CardHeader>
      <CardContent class="grid gap-4">
        <div>
          <p class="text-sm font-medium">{{ copy("settings.registeredRunners") }}</p>
          <p v-if="runners.length === 0" class="mt-2 text-sm text-muted-foreground">
            {{ copy("settings.noRunners") }}
          </p>
          <ul v-else class="mt-2 divide-y">
            <li
              v-for="runner in runners"
              :key="runner.runnerName"
              class="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div class="grid gap-1">
                <div class="flex items-center gap-2">
                  <span class="font-medium">{{ runner.runnerName }}</span>
                  <Badge :variant="runner.status === 'active' ? 'secondary' : 'outline'">
                    {{ copy(`settings.runnerStatus.${runner.status}`) }}
                  </Badge>
                </div>
                <p class="text-sm text-muted-foreground">
                  {{
                    [runner.capabilities.claudeVersion, runner.capabilities.codexVersion]
                      .filter(Boolean)
                      .join(" · ")
                  }}
                </p>
                <p class="text-xs text-muted-foreground">
                  {{ copy("settings.lastSeen") }} ·
                  <time :datetime="runner.lastSeenAt">{{
                    new Date(runner.lastSeenAt).toLocaleString(settings.locale)
                  }}</time>
                </p>
              </div>
              <Button
                v-if="runner.status === 'active'"
                size="sm"
                variant="outline"
                :disabled="pendingRunnerNames.has(runner.runnerName)"
                @click="revokeRunner(runner)"
                >{{ copy("settings.revokeRunner") }}</Button
              >
            </li>
          </ul>
        </div>
        <Separator />
        <Button class="w-fit" variant="outline" :disabled="pairingBusy" @click="issuePairingCode">
          {{ copy("settings.issuePairing") }}
        </Button>
        <div v-if="pairing" class="rounded-lg border p-4" aria-live="polite">
          <p class="text-sm text-muted-foreground">{{ copy("settings.pairingCode") }}</p>
          <code class="mt-2 block text-2xl font-semibold tracking-[0.25em]">{{
            pairing.code
          }}</code>
          <p class="mt-2 text-sm text-muted-foreground">
            {{ copy("settings.pairingExpires") }} ·
            <time :datetime="pairing.expiresAt">{{
              new Date(pairing.expiresAt).toLocaleString(settings.locale)
            }}</time>
          </p>
        </div>
      </CardContent>
    </Card>

    <section aria-labelledby="accessibility-title" class="max-w-3xl border-t border-border pt-6">
      <p class="eyebrow">{{ copy("settings.accessibility") }}</p>
      <h2 id="accessibility-title" class="mt-3 text-xl font-semibold tracking-tight">
        {{ copy("settings.accessibility") }}
      </h2>
      <p class="route-copy mt-3 text-sm">{{ copy("settings.accessibilityCopy") }}</p>
    </section>
  </div>
</template>
