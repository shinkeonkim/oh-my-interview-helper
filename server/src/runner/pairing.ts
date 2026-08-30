import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import type { Database } from "bun:sqlite"
import { z } from "zod"

import { OperationsRepositories } from "../db/operations-repositories"
import { RunnerNameSchema } from "../db/operations-repository-schemas"

const PairingCodeSchema = z.string().regex(/^[A-Z0-9]{8}$/)
const RunnerCapabilitiesSchema = z
  .object({
    protocolVersion: z.literal(1),
    claudeSubscription: z.boolean(),
    claudeDirectAuth: z.boolean(),
    claudeBare: z.boolean(),
    codexSkipGitRepoCheck: z.boolean(),
    claudeVersion: z.string().trim().min(1).max(128).nullable(),
    codexVersion: z.string().trim().min(1).max(128).nullable()
  })
  .strict()

type PendingPairing = { readonly hash: string; readonly expiresAt: number }
export type RunnerSummary = {
  readonly runnerName: string
  readonly capabilities: z.output<typeof RunnerCapabilitiesSchema>
  readonly status: "active" | "revoked"
  readonly registeredAt: string
  readonly lastSeenAt: string
  readonly revokedAt: string | null
}

export class RunnerPairingService {
  private readonly pending = new Map<string, PendingPairing>()
  private readonly operations: OperationsRepositories

  constructor(
    private readonly database: Database,
    private readonly now: () => number = Date.now
  ) {
    this.operations = new OperationsRepositories(database)
  }

  issueCode(): { readonly code: string; readonly expiresAt: string } {
    const code = randomBytes(4).toString("hex").toUpperCase()
    const expiresAt = this.now() + 5 * 60_000
    this.pending.set(digest(code), { hash: digest(code), expiresAt })
    return { code: PairingCodeSchema.parse(code), expiresAt: new Date(expiresAt).toISOString() }
  }

  pair(input: {
    readonly code: string
    readonly runnerName: string
    readonly capabilities: unknown
  }): { readonly runnerId: string; readonly token: string } {
    const code = PairingCodeSchema.parse(input.code)
    const pairingHash = digest(code)
    const pending = this.pending.get(pairingHash)
    this.pending.delete(pairingHash)
    if (pending === undefined || pending.expiresAt < this.now())
      throw new RunnerPairingError("pairing_denied")
    const token = randomBytes(32).toString("base64url")
    const runnerId = crypto.randomUUID()
    const timestamp = new Date(this.now()).toISOString()
    const registration = this.operations.upsertRunnerRegistration({
      id: runnerId,
      runnerName: RunnerNameSchema.parse(input.runnerName),
      tokenHash: digest(token),
      capabilities: RunnerCapabilitiesSchema.parse(input.capabilities),
      status: "active",
      registeredAt: timestamp,
      lastSeenAt: timestamp,
      revokedAt: null
    })
    return { runnerId: registration.id, token }
  }

  authenticate(input: { readonly runnerId: string; readonly token: string }): boolean {
    return this.authorize(input) !== null
  }

  authorize(input: {
    readonly runnerId: string
    readonly token: string
  }): { readonly capabilities: z.output<typeof RunnerCapabilitiesSchema> } | null {
    const row = this.database
      .query<
        { readonly tokenHash: string; readonly status: string; readonly capabilities: string },
        [string]
      >(
        "SELECT token_hash tokenHash,status,capability_json capabilities FROM runner_registrations WHERE id=?"
      )
      .get(z.string().uuid().parse(input.runnerId))
    if (row === null || row.status !== "active") return null
    const actual = Buffer.from(digest(input.token), "hex")
    const expected = Buffer.from(row.tokenHash, "hex")
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
    this.touch(input.runnerId)
    return { capabilities: RunnerCapabilitiesSchema.parse(JSON.parse(row.capabilities)) }
  }

  touch(runnerId: string): void {
    this.database.run(
      "UPDATE runner_registrations SET last_seen_at=? WHERE id=? AND status='active'",
      [new Date(this.now()).toISOString(), z.string().uuid().parse(runnerId)]
    )
  }

  list(): readonly RunnerSummary[] {
    return this.database
      .query<
        {
          readonly runnerName: string
          readonly capabilities: string
          readonly status: "active" | "revoked"
          readonly registeredAt: string
          readonly lastSeenAt: string
          readonly revokedAt: string | null
        },
        []
      >(
        "SELECT runner_name runnerName,capability_json capabilities,status,registered_at registeredAt,last_seen_at lastSeenAt,revoked_at revokedAt FROM runner_registrations ORDER BY last_seen_at DESC,runner_name"
      )
      .all()
      .map((row) => ({
        ...row,
        capabilities: RunnerCapabilitiesSchema.parse(JSON.parse(row.capabilities))
      }))
  }

  revoke(runnerName: string): string | null {
    const registration = this.database
      .query<{ readonly id: string }, [string]>(
        "SELECT id FROM runner_registrations WHERE runner_name=? AND status='active'"
      )
      .get(RunnerNameSchema.parse(runnerName))
    if (registration === null) return null
    const timestamp = new Date(this.now()).toISOString()
    this.database.run(
      "UPDATE runner_registrations SET status='revoked',revoked_at=?,last_seen_at=? WHERE runner_name=? AND status='active'",
      [timestamp, timestamp, RunnerNameSchema.parse(runnerName)]
    )
    return registration.id
  }
}

const digest = (value: string): string => createHash("sha256").update(value).digest("hex")

export class RunnerPairingError extends Error {
  override readonly name = "RunnerPairingError"
  constructor(readonly code: "pairing_denied") {
    super("RUNNER_PAIRING_DENIED")
  }
}
