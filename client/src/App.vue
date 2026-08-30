<script setup lang="ts">
import { LoaderCircle } from "lucide-vue-next"

import { Toaster } from "@/components/ui/sonner"
import AppShell from "./components/AppShell.vue"
import { translate } from "./locales"
import { useSettingsStore } from "./stores/settings"

const settings = useSettingsStore()
</script>

<template>
  <AppShell>
    <RouterView v-slot="{ Component }">
      <Suspense>
        <div class="contents">
          <component :is="Component" />
        </div>
        <template #fallback>
          <div
            class="flex min-h-48 items-center justify-center gap-2 text-muted-foreground"
            role="status"
          >
            <LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
            {{ translate(settings.locale, "actions.loading") }}
          </div>
        </template>
      </Suspense>
    </RouterView>
  </AppShell>
  <Toaster position="bottom-right" />
</template>
