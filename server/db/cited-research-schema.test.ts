import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPersistence, type Persistence } from "../src/db"

const directories: string[] = []
const handles: Persistence[] = []
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("cited research schema", () => {
  test("rejects uncited facts and cross-record source references while preserving refresh ancestry", () => {
    const directory = mkdtempSync(join(tmpdir(), "cited-research-schema-"))
    directories.push(directory)
    const persistence = createPersistence({ dataDirectory: directory })
    handles.push(persistence)
    const first = crypto.randomUUID()
    const refresh = crypto.randomUUID()
    const source = crypto.randomUUID()
    const at = new Date().toISOString()
    persistence.database.run(
      "INSERT INTO research_records (id,kind,status,created_at,subject_type,subject_name,identity_status) VALUES (?,?,?,?,?,?,?)",
      [first, "company", "active", at, "company", "Acme", "confirmed"]
    )
    persistence.database.run(
      "INSERT INTO research_records (id,kind,status,created_at,subject_type,subject_name,parent_record_id,identity_status) VALUES (?,?,?,?,?,?,?,?)",
      [refresh, "company", "active", at, "company", "Acme", first, "confirmed"]
    )
    persistence.database.run(
      "INSERT INTO research_sources (id,research_record_id,canonical_url,title,content_hash,excerpt,status,retrieved_at) VALUES (?,?,?,?,?,?,?,?)",
      [
        source,
        first,
        "https://example.com/company",
        "Company",
        "a".repeat(64),
        "Public source",
        "available",
        at
      ]
    )
    expect(() =>
      persistence.database.run(
        "INSERT INTO research_claims (id,research_record_id,statement,classification,source_ids_json,confidence,created_at) VALUES (?,?,?,?,?,?,?)",
        [crypto.randomUUID(), refresh, "Uncited fact", "fact", "[]", "high", at]
      )
    ).toThrow("research fact requires citation")
    expect(() =>
      persistence.database.run(
        "INSERT INTO research_claims (id,research_record_id,statement,classification,source_ids_json,confidence,created_at) VALUES (?,?,?,?,?,?,?)",
        [
          crypto.randomUUID(),
          refresh,
          "Cross-record citation",
          "fact",
          JSON.stringify([source]),
          "high",
          at
        ]
      )
    ).toThrow("research claim source missing")
    expect(
      persistence.database
        .query<{ parent: string }, [string]>(
          "SELECT parent_record_id parent FROM research_records WHERE id=?"
        )
        .get(refresh)?.parent
    ).toBe(first)
  })
})
