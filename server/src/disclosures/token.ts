import { createHmac, timingSafeEqual } from "node:crypto"

import { z } from "zod"

import { DisclosureError, DisclosureTokenPayloadSchema, canonical } from "./contracts"

export class DisclosureTokenCodec {
  constructor(private readonly signingKey: Uint8Array) {}
  sign(payload: z.output<typeof DisclosureTokenPayloadSchema>): string {
    const body = Buffer.from(canonical(payload)).toString("base64url")
    return `${body}.${createHmac("sha256", this.signingKey).update(body).digest("base64url")}`
  }
  verify(token: string): z.output<typeof DisclosureTokenPayloadSchema> {
    const [body, signature, extra] = token.split(".")
    if (body === undefined || signature === undefined || extra !== undefined)
      throw new DisclosureError("DISCLOSURE_INVALID")
    const expected = createHmac("sha256", this.signingKey).update(body).digest("base64url")
    if (
      expected.length !== signature.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    )
      throw new DisclosureError("DISCLOSURE_INVALID")
    try {
      return DisclosureTokenPayloadSchema.parse(
        JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
      )
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        throw new DisclosureError("DISCLOSURE_INVALID")
      throw error
    }
  }
}
