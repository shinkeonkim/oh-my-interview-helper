import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

import { ApplicationCreateSchema } from "../src/db/domain-repositories"
import { createPersistence, type Persistence } from "../src/db/index"

const temporaryDirectories: string[] = []
const makeDataDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "interview-helper-domain-"))
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

describe("job-post and application repositories", () => {
  test("allocates ordered, unique job-post versions across persistence handles", async () => {
    const dataDirectory = makeDataDirectory()
    const seed = createPersistence({ dataDirectory })
    const post = createJobPost(seed)
    seed.close()
    const writer = (versionId: string, version: string) =>
      Bun.spawn(
        [
          "bun",
          "-e",
          `import { createPersistence } from "./server/src/db/index.ts"
const [dataDirectory, jobPostId, versionId, version] = process.argv.slice(-4)
const persistence = createPersistence({ dataDirectory })
persistence.repositories.domain.addJobPostVersion({ id: versionId, jobPostId, sourceKind: "manual", content: { version: Number(version) } })
persistence.close()`,
          dataDirectory,
          post.id,
          versionId,
          version
        ],
        { cwd: process.cwd(), stderr: "pipe" }
      )
    const firstWriter = writer(crypto.randomUUID(), "1")
    const secondWriter = writer(crypto.randomUUID(), "2")

    expect(await Promise.all([firstWriter.exited, secondWriter.exited])).toEqual([0, 0])
    const persistence = createPersistence({ dataDirectory })
    expect(
      persistence.database
        .query<{ readonly version_number: number }, [string]>(
          "SELECT version_number FROM job_post_versions WHERE job_post_id=? ORDER BY version_number"
        )
        .all(post.id)
        .map(({ version_number }) => version_number)
    ).toEqual([1, 2])
    const [firstVersion] = persistence.repositories.domain.listJobPostVersions(post.id)
    if (firstVersion === undefined) throw new Error("concurrent version insert failed")
    expect(() =>
      persistence.repositories.domain.addJobPostVersion({
        id: firstVersion.id,
        jobPostId: post.id,
        sourceKind: "file",
        content: { duplicate: true }
      })
    ).toThrow()
    persistence.close()
  })

  test("keeps job-post current-version pointers present and parent scoped", () => {
    const persistence = createPersistence({ dataDirectory: makeDataDirectory() })
    const first = createJobPost(persistence)
    const second = createJobPost(persistence)
    persistence.repositories.domain.addJobPostVersion({
      id: crypto.randomUUID(),
      jobPostId: first.id,
      sourceKind: "manual",
      content: { post: "first" }
    })
    const secondVersion = persistence.repositories.domain.addJobPostVersion({
      id: crypto.randomUUID(),
      jobPostId: second.id,
      sourceKind: "manual",
      content: { post: "second" }
    })

    expect(() =>
      persistence.database.run("UPDATE job_posts SET current_version_id=? WHERE id=?", [
        crypto.randomUUID(),
        first.id
      ])
    ).toThrow()
    expect(() =>
      persistence.database.run("UPDATE job_posts SET current_version_id=? WHERE id=?", [
        secondVersion.id,
        first.id
      ])
    ).toThrow("job post version parent mismatch")
    persistence.close()
  })

  test("rejects invalid application status, duplicate idempotency, and missing parents", () => {
    const persistence = createPersistence({ dataDirectory: makeDataDirectory() })
    const post = createJobPost(persistence)
    const idempotencyKey = crypto.randomUUID()
    const application = persistence.repositories.domain.createApplication({
      id: crypto.randomUUID(),
      jobPostId: post.id,
      idempotencyKey
    })

    expect(persistence.repositories.domain.getApplication(application.id)).toEqual(application)
    expect(persistence.repositories.domain.listApplications()).toEqual([application])
    expect(() =>
      ApplicationCreateSchema.parse({
        id: crypto.randomUUID(),
        jobPostId: post.id,
        idempotencyKey: crypto.randomUUID(),
        status: "invalid"
      })
    ).toThrow(z.ZodError)
    expect(() =>
      persistence.repositories.domain.createApplication({
        id: crypto.randomUUID(),
        jobPostId: post.id,
        idempotencyKey
      })
    ).toThrow()
    expect(() =>
      persistence.database.run(
        "INSERT INTO applications (id,job_post_id,status,idempotency_key,created_at) VALUES (?,?,?,?,?)",
        [crypto.randomUUID(), post.id, "invalid", crypto.randomUUID(), new Date().toISOString()]
      )
    ).toThrow()
    expect(() =>
      persistence.repositories.domain.createApplication({
        id: crypto.randomUUID(),
        jobPostId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID()
      })
    ).toThrow()
    expect(() =>
      persistence.repositories.domain.addJobPostVersion({
        id: crypto.randomUUID(),
        jobPostId: crypto.randomUUID(),
        sourceKind: "manual",
        content: {}
      })
    ).toThrow()
    persistence.close()
  })
})
