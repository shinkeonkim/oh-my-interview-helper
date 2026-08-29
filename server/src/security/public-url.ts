import { z } from "zod"

export const PublicHttpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value)
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.username === "" &&
        url.password === ""
      )
    } catch {
      return false
    }
  }, "Public URLs must use HTTP(S) without credentials")
