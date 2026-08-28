import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPersistence, type Persistence } from "../src/db"

const handles: Persistence[] = []
const directories: string[] = []
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("application pipeline schema", () => {
  test("seeds ordered stages and keeps interview and event history referentially safe", () => {
    const directory = mkdtempSync(join(tmpdir(), "application-pipeline-schema-"))
    directories.push(directory)
    const persistence = createPersistence({ dataDirectory: directory })
    handles.push(persistence)
    const stages = persistence.database
      .query<{ stageKey: string; position: number }, []>(
        "SELECT stage_key stageKey,position FROM pipeline_stages ORDER BY position"
      )
      .all()
    expect(stages.map((stage) => stage.stageKey)).toEqual([
      "saved",
      "applied",
      "interviewing",
      "offered",
      "rejected",
      "withdrawn"
    ])
    expect(stages.map((stage) => stage.position)).toEqual([1, 2, 3, 4, 5, 6])
    expect(() =>
      persistence.database.run(
        "INSERT INTO application_interviews (id,application_id,scheduled_at,interview_kind,created_at) VALUES (?,?,?,?,?)",
        [
          crypto.randomUUID(),
          crypto.randomUUID(),
          new Date().toISOString(),
          "technical",
          new Date().toISOString()
        ]
      )
    ).toThrow()
  })
})
