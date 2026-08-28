import type { Database } from "bun:sqlite"

import { type ArtifactId, type ProviderRunId } from "./ids"
import {
  ArtifactCreateSchema,
  ArtifactInputCreateSchema,
  ArtifactKindSchema,
  mapArtifact,
  mapArtifactInput,
  mapProviderRun,
  ProviderRunCreateSchema,
  ProviderRunMetadataSchema,
  type Artifact,
  type ArtifactInput,
  type ArtifactInputSourceKind,
  type ArtifactKind,
  type ProviderRun
} from "./provider-artifact-repository-schemas"
import { transitionProviderRun, type ProviderRunTerminal } from "./provider-run-transitions"

export {
  ArtifactCreateSchema,
  ArtifactInputCreateSchema,
  ArtifactInputSourceKindSchema,
  ArtifactKindSchema,
  ArtifactStatusSchema,
  ProviderRunCreateSchema,
  ProviderRunModeSchema,
  ProviderRunStatusSchema
} from "./provider-artifact-repository-schemas"
export type {
  Artifact,
  ArtifactInput,
  ArtifactInputSourceKind,
  ArtifactKind,
  ProviderRun
} from "./provider-artifact-repository-schemas"
export { ProviderRunTransitionError } from "./provider-run-transitions"

const now = (): string => new Date().toISOString()

export class ArtifactVersionConflictError extends Error {
  override readonly name = "ArtifactVersionConflictError"

  constructor(
    readonly kind: ArtifactKind,
    readonly version: number
  ) {
    super(`ARTIFACT_VERSION_CONFLICT: ${kind}@${version}`)
  }
}
export class ProviderArtifactRepository {
  constructor(private readonly database: Database) {}

  createProviderRun(input: ProviderRun): ProviderRun {
    const value = ProviderRunCreateSchema.parse(input)
    const metadata = ProviderRunMetadataSchema.parse({
      mode: value.mode,
      model: value.model,
      usage: value.usage,
      cost: value.cost,
      error: value.error
    })
    this.database.run(
      "INSERT INTO provider_runs (id,provider_kind,status,request_hash,usage_json,created_at,completed_at) VALUES (?,?,?,?,?,?,?)",
      [
        value.id,
        value.providerKind,
        value.status,
        value.requestHash,
        JSON.stringify(metadata),
        now(),
        value.completedAt
      ]
    )
    return value
  }
  createRunning(
    input: Omit<ProviderRun, "status" | "usage" | "cost" | "error" | "completedAt">
  ): ProviderRun {
    return this.createProviderRun({
      ...input,
      status: "running",
      usage: null,
      cost: null,
      error: null,
      completedAt: null
    })
  }
  completeProviderRun(
    id: ProviderRunId,
    usage: ProviderRun["usage"],
    cost: ProviderRun["cost"]
  ): ProviderRun {
    return this.transition(id, "succeeded", usage, cost, null)
  }
  failProviderRun(
    id: ProviderRunId,
    usage: ProviderRun["usage"],
    cost: ProviderRun["cost"],
    error: NonNullable<ProviderRun["error"]>
  ): ProviderRun {
    return this.transition(id, "failed", usage, cost, error)
  }
  cancelProviderRun(
    id: ProviderRunId,
    usage: ProviderRun["usage"],
    cost: ProviderRun["cost"]
  ): ProviderRun {
    return this.transition(id, "cancelled", usage, cost, {
      category: "cancelled",
      retryable: false
    })
  }

  getProviderRun(id: ProviderRunId): ProviderRun | null {
    const row = this.database
      .query<unknown, [ProviderRunId]>(
        "SELECT id,provider_kind providerKind,status,request_hash requestHash,usage_json metadata,completed_at completedAt FROM provider_runs WHERE id=?"
      )
      .get(id)
    return row === null ? null : mapProviderRun(row)
  }

  listProviderRuns(): readonly ProviderRun[] {
    return this.database
      .query<unknown, []>(
        "SELECT id,provider_kind providerKind,status,request_hash requestHash,usage_json metadata,completed_at completedAt FROM provider_runs ORDER BY created_at,id"
      )
      .all()
      .map(mapProviderRun)
  }

  createArtifact(input: Artifact): Artifact {
    const value = ArtifactCreateSchema.parse(input)
    this.database
      .transaction(() => {
        const existing = this.database
          .query<{ readonly id: ArtifactId }, [ArtifactKind, number]>(
            "SELECT id FROM artifacts WHERE artifact_type=? AND version_number=?"
          )
          .get(value.kind, value.version)
        if (existing !== null) throw new ArtifactVersionConflictError(value.kind, value.version)
        this.database.run(
          "INSERT INTO artifacts (id,artifact_type,state,provider_run_id,body_blob_hash,structured_output,version_number,created_at) VALUES (?,?,?,?,?,?,?,?)",
          [
            value.id,
            value.kind,
            value.status,
            value.providerRunId,
            value.bodyBlobHash,
            JSON.stringify(value.content),
            value.version,
            now()
          ]
        )
      })
      .immediate()
    return value
  }

  getArtifact(id: ArtifactId): Artifact | null {
    const row = this.database
      .query<unknown, [ArtifactId]>(
        "SELECT id,artifact_type kind,state status,provider_run_id providerRunId,body_blob_hash bodyBlobHash,structured_output content,version_number version FROM artifacts WHERE id=?"
      )
      .get(id)
    return row === null ? null : mapArtifact(row)
  }

  listArtifacts(kind: ArtifactKind): readonly Artifact[] {
    const parsedKind = ArtifactKindSchema.parse(kind)
    return this.database
      .query<unknown, [ArtifactKind]>(
        "SELECT id,artifact_type kind,state status,provider_run_id providerRunId,body_blob_hash bodyBlobHash,structured_output content,version_number version FROM artifacts WHERE artifact_type=? ORDER BY version_number"
      )
      .all(parsedKind)
      .map(mapArtifact)
  }

  createArtifactInput(input: ArtifactInput): ArtifactInput {
    const value = ArtifactInputCreateSchema.parse(input)
    switch (value.source.kind) {
      case "document_version":
        this.database.run(
          "INSERT INTO artifact_inputs (artifact_id,input_kind,document_version_id,created_at) VALUES (?,?,?,?)",
          [value.artifactId, value.source.kind, value.source.documentVersionId, now()]
        )
        return value
      case "job_post_version":
        this.database.run(
          "INSERT INTO artifact_inputs (artifact_id,input_kind,job_post_version_id,created_at) VALUES (?,?,?,?)",
          [value.artifactId, value.source.kind, value.source.jobPostVersionId, now()]
        )
        return value
      case "research_record":
        this.database.run(
          "INSERT INTO artifact_inputs (artifact_id,input_kind,research_record_id,created_at) VALUES (?,?,?,?)",
          [value.artifactId, value.source.kind, value.source.researchRecordId, now()]
        )
        return value
      case "source_hash":
        this.database.run(
          "INSERT INTO artifact_inputs (artifact_id,input_kind,source_hash,created_at) VALUES (?,?,?,?)",
          [value.artifactId, value.source.kind, value.source.sourceHash, now()]
        )
        return value
    }
  }

  getArtifactInput(
    artifactId: ArtifactId,
    sourceKind: ArtifactInputSourceKind
  ): ArtifactInput | null {
    const row = this.database
      .query<unknown, [ArtifactId, ArtifactInputSourceKind]>(
        "SELECT artifact_id artifactId,input_kind sourceKind,document_version_id documentVersionId,job_post_version_id jobPostVersionId,research_record_id researchRecordId,source_hash sourceHash FROM artifact_inputs WHERE artifact_id=? AND input_kind=?"
      )
      .get(artifactId, sourceKind)
    return row === null ? null : mapArtifactInput(row)
  }

  listArtifactInputs(artifactId: ArtifactId): readonly ArtifactInput[] {
    return this.database
      .query<unknown, [ArtifactId]>(
        "SELECT artifact_id artifactId,input_kind sourceKind,document_version_id documentVersionId,job_post_version_id jobPostVersionId,research_record_id researchRecordId,source_hash sourceHash FROM artifact_inputs WHERE artifact_id=? ORDER BY input_kind"
      )
      .all(artifactId)
      .map(mapArtifactInput)
  }

  transaction<Result>(action: () => Result): Result {
    return this.database.transaction(action).immediate()
  }
  transitionInTransaction(id: ProviderRunId, terminal: ProviderRunTerminal): ProviderRun {
    return transitionProviderRun(this.database, id, terminal)
  }
  private transition(
    id: ProviderRunId,
    status: "succeeded" | "failed" | "cancelled",
    usage: ProviderRun["usage"],
    cost: ProviderRun["cost"],
    error: ProviderRun["error"]
  ): ProviderRun {
    return this.database
      .transaction(() => this.transitionInTransaction(id, { status, usage, cost, error }))
      .immediate()
  }
}
