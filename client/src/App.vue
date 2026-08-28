<script setup lang="ts">
import { Toaster } from "@/components/ui/sonner"
import AppShell from "./components/AppShell.vue"
</script>

<template>
  <AppShell>
    <RouterView />
  </AppShell>
  <Toaster position="bottom-right" />
</template>
