<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
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
const providers = ref<Provider[]>([])
const pairing = ref<PairingCode | null>(null)
const savingProvider = ref<string | null>(null)
const loadingProviders = ref(true)
const csrf = async () =>
  ((await (await fetch("/api/security/csrf")).json()) as { csrfToken: string }).csrfToken
const loadProviders = async () => {
  loadingProviders.value = true
  try {
    const response = await fetch("/api/providers/status")
    if (!response.ok) throw new Error("request")
    const body = (await response.json()) as { providers?: unknown }
    if (!Array.isArray(body.providers)) throw new Error("response")
    providers.value = body.providers as Provider[]
  } catch {
    toast.error(copy("settings.providersFailed"))
  } finally {
    loadingProviders.value = false
  }
}
const setProvider = async (provider: Provider, enabled: boolean) => {
  savingProvider.value = provider.id
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
    toast.success(copy("settings.providerSaved"))
  } catch {
    toast.error(copy("settings.providersFailed"))
  } finally {
    savingProvider.value = null
  }
}
const issuePairingCode = async () => {
  try {
    const response = await fetch("/api/runners/pairing-code", {
      method: "POST",
      headers: { "X-CSRF-Token": await csrf() }
    })
    if (!response.ok) throw new Error("request")
    pairing.value = (await response.json()) as PairingCode
  } catch {
    toast.error(copy("settings.pairingFailed"))
  }
}
onMounted(() => void loadProviders())
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
              :disabled="savingProvider === provider.id"
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
        <Button class="w-fit" variant="outline" @click="issuePairingCode">
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
