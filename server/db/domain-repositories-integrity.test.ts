import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

import { createPersistence, type Persistence } from "../src/db/index"

const temporaryDirectories: string[] = []
const makeDataDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-domain-integrity-"))
  temporaryDirectories.push(directory)
  return directory
}
const createJobPost = (persistence: Persistence) =>
  persistence.repositories.domain.createJobPost({
    id: crypto.randomUUID(),
    title: "Engineer",
    companyName: "Example"
  })

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { force: true, recursive: true })
})

describe("job-post and application repository integrity", () => {
  test("appends ordered, unique application events and rejects missing applications", () => {
    const persistence = createPersistence({ dataDirectory: makeDataDirectory() })
    const post = createJobPost(persistence)
    const application = persistence.repositories.domain.createApplication({
      id: crypto.randomUUID(),
      jobPostId: post.id,
      idempotencyKey: crypto.randomUUID()
    })
    const created = persistence.repositories.domain.appendApplicationEvent({
      id: crypto.randomUUID(),
      applicationId: application.id,
      kind: "created",
      payload: { stage: "saved" }
    })
    const applied = persistence.repositories.domain.appendApplicationEvent({
      id: crypto.randomUUID(),
      applicationId: application.id,
      kind: "applied",
      payload: { stage: "applied", source: { kind: "url" } }
    })

    expect(persistence.repositories.domain.listApplicationEvents(application.id)).toEqual([
      created,
      applied
    ])
    expect(() =>
      persistence.database.run(
        "INSERT INTO application_events (id,application_id,sequence,event_kind,payload,created_at) VALUES (?,?,?,?,?,?)",
        [crypto.randomUUID(), application.id, 1, "duplicate", "{}", new Date().toISOString()]
      )
    ).toThrow()
    expect(() =>
      persistence.repositories.domain.appendApplicationEvent({
        id: crypto.randomUUID(),
        applicationId: crypto.randomUUID(),
        kind: "missing-parent",
        payload: {}
      })
    ).toThrow()
    persistence.close()
  })

  test("rejects non-JSON-safe inputs and malformed persisted JSON with Zod errors", () => {
    const persistence = createPersistence({ dataDirectory: makeDataDirectory() })
    const post = createJobPost(persistence)
    const application = persistence.repositories.domain.createApplication({
      id: crypto.randomUUID(),
      jobPostId: post.id,
      idempotencyKey: crypto.randomUUID()
    })

    expect(() =>
      persistence.repositories.domain.addJobPostVersion({
        id: crypto.randomUUID(),
        jobPostId: post.id,
        sourceKind: "manual",
        content: { omitted: undefined }
      })
    ).toThrow(z.ZodError)
    expect(() =>
      persistence.database.run(
        "INSERT INTO job_post_versions (id,job_post_id,version_number,source_kind,structured_content,created_at) VALUES (?,?,?,?,?,?)",
        [crypto.randomUUID(), post.id, 1, "manual", "not-json", new Date().toISOString()]
      )
    ).toThrow()
    expect(() =>
      persistence.database.run(
        "INSERT INTO application_events (id,application_id,sequence,event_kind,payload,created_at) VALUES (?,?,?,?,?,?)",
        [crypto.randomUUID(), application.id, 1, "bad", "not-json", new Date().toISOString()]
      )
    ).toThrow()
    persistence.database.run("PRAGMA ignore_check_constraints = ON")
    persistence.database.run(
      "INSERT INTO job_post_versions (id,job_post_id,version_number,source_kind,structured_content,created_at) VALUES (?,?,?,?,?,?)",
      [crypto.randomUUID(), post.id, 1, "manual", "not-json", new Date().toISOString()]
    )
    persistence.database.run(
      "INSERT INTO application_events (id,application_id,sequence,event_kind,payload,created_at) VALUES (?,?,?,?,?,?)",
      [crypto.randomUUID(), application.id, 1, "bad", "not-json", new Date().toISOString()]
    )
    persistence.database.run("PRAGMA ignore_check_constraints = OFF")

    expect(() => persistence.repositories.domain.listJobPostVersions(post.id)).toThrow(z.ZodError)
    expect(() => persistence.repositories.domain.listApplicationEvents(application.id)).toThrow(
      z.ZodError
    )
    persistence.close()
  })

  test("rolls back composed job-post, application, and event writes", () => {
    const persistence = createPersistence({ dataDirectory: makeDataDirectory() })
    const postId = crypto.randomUUID()
    const applicationId = crypto.randomUUID()

    expect(() =>
      persistence.repositories.transaction(() => {
        const post = persistence.repositories.domain.createJobPost({
          id: postId,
          title: "Rollback",
          companyName: "Example"
        })
        persistence.repositories.domain.addJobPostVersion({
          id: crypto.randomUUID(),
          jobPostId: post.id,
          sourceKind: "manual",
          content: {}
        })
        const application = persistence.repositories.domain.createApplication({
          id: applicationId,
          jobPostId: post.id,
          idempotencyKey: crypto.randomUUID()
        })
        persistence.repositories.domain.appendApplicationEvent({
          id: crypto.randomUUID(),
          applicationId: application.id,
          kind: "created",
          payload: {}
        })
        throw new Error("rollback")
      })
    ).toThrow("rollback")
    expect(persistence.repositories.domain.getJobPost(postId)).toBeNull()
    expect(persistence.repositories.domain.getApplication(applicationId)).toBeNull()
    persistence.close()
  })
})
