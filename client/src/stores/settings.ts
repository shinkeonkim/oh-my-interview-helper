import { computed, onScopeDispose, ref, watch } from "vue"
import { defineStore } from "pinia"

import { resolveLocale, type Locale } from "../locales"

export const THEMES = ["system", "light", "dark"] as const
export type Theme = (typeof THEMES)[number]

const LOCALE_STORAGE_KEY = "interview-helper.locale"
const THEME_STORAGE_KEY = "interview-helper.theme"

const readStoredValue = (key: string): string | null => {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(key)
  } catch (error) {
    if (error instanceof DOMException) return null
    throw error
  }
}

export const resolveTheme = (value: unknown): Theme => {
  if (value === "light" || value === "dark" || value === "system") return value
  return "system"
}

const persist = (key: string, value: string): void => {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, value)
  } catch (error) {
    if (error instanceof DOMException) return
    throw error
  }
}

export const useSettingsStore = defineStore("settings", () => {
  const locale = ref<Locale>(resolveLocale(readStoredValue(LOCALE_STORAGE_KEY)))
  const theme = ref<Theme>(resolveTheme(readStoredValue(THEME_STORAGE_KEY)))
  const systemDark = ref(false)

  const effectiveTheme = computed<Exclude<Theme, "system">>(() => {
    if (theme.value === "system") return systemDark.value ? "dark" : "light"
    return theme.value
  })

  const applyPreferences = (): void => {
    if (typeof document === "undefined") return
    document.documentElement.lang = locale.value
    document.documentElement.classList.toggle("dark", effectiveTheme.value === "dark")
    document.documentElement.dataset["theme"] = effectiveTheme.value
  }

  const mediaQuery =
    typeof window === "undefined" ? null : window.matchMedia("(prefers-color-scheme: dark)")
  if (mediaQuery) {
    systemDark.value = mediaQuery.matches
    const onSystemThemeChange = (event: MediaQueryListEvent): void => {
      systemDark.value = event.matches
      applyPreferences()
    }
    mediaQuery.addEventListener("change", onSystemThemeChange)
    onScopeDispose(() => mediaQuery.removeEventListener("change", onSystemThemeChange))
  }

  const setLocale = (nextLocale: Locale): void => {
    locale.value = nextLocale
    persist(LOCALE_STORAGE_KEY, nextLocale)
    applyPreferences()
  }

  const setTheme = (nextTheme: Theme): void => {
    theme.value = nextTheme
    persist(THEME_STORAGE_KEY, nextTheme)
    applyPreferences()
  }

  watch([locale, effectiveTheme], applyPreferences, { immediate: true })

  return { locale, theme, effectiveTheme, setLocale, setTheme }
})
