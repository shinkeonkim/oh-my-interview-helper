import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

import { applyMigrations, MigrationFailureError } from "./migrations"
import { DocumentCreateSchema, Repositories } from "./repositories"
import { migrations, type Migration } from "./schema"
import { BlobStore } from "../storage/blob-store"

export { applyMigrations, MigrationFailureError, DocumentCreateSchema, type Migration }
export * from "./domain-repositories"
export * from "./operations-repositories"
export * from "./provider-artifact-repositories"
export * from "./research-conversation-repositories"
export * from "../jobs/types"
export { JobsRepository } from "../jobs/repository"
export { BlobRepository, DocumentRepository, Repositories } from "./repositories"
export type PersistenceOptions = {
  readonly dataDirectory: string
  readonly migrations?: readonly Migration[]
}
export type Persistence = {
  readonly database: Database
  readonly repositories: Repositories
  readonly blobs: BlobStore
  close: () => void
}

const enableWal = (database: Database): void => {
  for (const delay of [0, 10, 20, 40, 80, 160, 320, 640, 1280, 2560]) {
    try {
      database.run("PRAGMA journal_mode = WAL")
      return
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("database is locked")) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay)
    }
  }
  throw new MigrationFailureError("lock")
}

export const createPersistence = ({
  dataDirectory,
  migrations: configuredMigrations = migrations
}: PersistenceOptions): Persistence => {
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 })
  const database = new Database(resolve(dataDirectory, "interview-helper.sqlite"), {
    create: true,
    readwrite: true,
    strict: true
  })
  try {
    database.run("PRAGMA busy_timeout = 5000")
    enableWal(database)
    database.run("PRAGMA foreign_keys = ON")
    applyMigrations(database, configuredMigrations)
    return {
      database,
      repositories: new Repositories(database),
      blobs: new BlobStore(dataDirectory),
      close: () => database.close(true)
    }
  } catch (error) {
    database.close(true)
    throw error
  }
}
