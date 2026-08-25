import { computed, type ComputedRef } from "vue"

import { en } from "./en"
import { ko } from "./ko"
import { LOCALES, type Locale, type LocaleMessages } from "./messages"

export { LOCALES, type Locale, type LocaleMessages }

const catalogs: Readonly<Record<Locale, LocaleMessages>> = { ko, en }

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && LOCALES.includes(value as Locale)

export const resolveLocale = (value: unknown): Locale => (isLocale(value) ? value : "ko")

const readKey = (catalog: LocaleMessages, path: string): string | undefined => {
  const value: unknown = path.split(".").reduce<unknown>((current, segment) => {
    if (typeof current !== "object" || current === null) return undefined
    return segment in current ? Reflect.get(current, segment) : undefined
  }, catalog)
  return typeof value === "string" ? value : undefined
}

export const translate = (locale: Locale, key: string): string =>
  readKey(catalogs[locale], key) ?? readKey(catalogs.ko, key) ?? `[${key}]`

export const useTranslator = (locale: ComputedRef<Locale>) =>
  computed(
    () =>
      (key: string): string =>
        translate(locale.value, key)
  )
