import type { Database } from "bun:sqlite"

import { migrationChecksum, type Migration } from "./schema"

export class MigrationFailureError extends Error {
  override readonly name = "MigrationFailureError"
  constructor(readonly code: "checksum_drift" | "execution" | "order" | "lock") {
    super(`MIGRATION_FAILURE: ${code}`)
  }
}

type AppliedMigration = { readonly id: string; readonly checksum: string }
const activeDatabases = new Set<string>()

export const applyMigrations = (database: Database, definitions: readonly Migration[]): void => {
  const key = database.filename
  if (activeDatabases.has(key)) throw new MigrationFailureError("lock")
  const orderedDefinitions = [...definitions].sort((left, right) => left.id.localeCompare(right.id))
  if (
    new Set(orderedDefinitions.map((migration) => migration.id)).size !== orderedDefinitions.length
  ) {
    throw new MigrationFailureError("order")
  }
  activeDatabases.add(key)
  try {
    database.run("BEGIN EXCLUSIVE")
    database.run(
      "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)"
    )
    const migrations = orderedDefinitions
    const applied = database
      .query<AppliedMigration, []>("SELECT id, checksum FROM schema_migrations ORDER BY id")
      .all()
    const known = new Map(migrations.map((migration) => [migration.id, migration]))
    for (const item of applied) {
      const definition = known.get(item.id)
      if (definition === undefined || item.checksum !== migrationChecksum(definition)) {
        throw new MigrationFailureError("checksum_drift")
      }
    }
    const appliedIds = new Set(applied.map((item) => item.id))
    const firstGap = migrations.findIndex((migration) => !appliedIds.has(migration.id))
    if (
      firstGap >= 0 &&
      migrations.slice(firstGap + 1).some((migration) => appliedIds.has(migration.id))
    ) {
      throw new MigrationFailureError("order")
    }
    for (const migration of migrations.slice(firstGap < 0 ? migrations.length : firstGap)) {
      try {
        database.exec(migration.sql)
        database.run("INSERT INTO schema_migrations (id, checksum, applied_at) VALUES (?, ?, ?)", [
          migration.id,
          migrationChecksum(migration),
          new Date().toISOString()
        ])
      } catch (error) {
        if (error instanceof MigrationFailureError) throw error
        throw new MigrationFailureError("execution")
      }
    }
    database.run("COMMIT")
  } catch (error) {
    if (database.inTransaction) database.run("ROLLBACK")
    throw error
  } finally {
    activeDatabases.delete(key)
  }
}
