import type { ko } from "./ko"

type StringCatalog<T> = {
  readonly [Key in keyof T]: T[Key] extends Readonly<Record<string, unknown>>
    ? StringCatalog<T[Key]>
    : string
}

export type LocaleMessages = StringCatalog<typeof ko>

export type Locale = "ko" | "en"

export const LOCALES = ["ko", "en"] as const
