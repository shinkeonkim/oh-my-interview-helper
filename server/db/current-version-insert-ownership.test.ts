import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPersistence, type Persistence } from "../src/db/index"

const directories: string[] = []
const timestamp = "2026-08-26T12:00:00.000Z"
const blobHash = "a".repeat(64)
const createTestPersistence = (): Persistence => {
  const dataDirectory = mkdtempSync(join(tmpdir(), "interview-helper-current-version-insert-"))
  directories.push(dataDirectory)
  return createPersistence({ dataDirectory })
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

test("rejects document current-version cross-parent inserts while allowing null initialization", () => {
  const persistence = createTestPersistence()
  persistence.database.run(
    "INSERT INTO blobs (sha256,byte_size,media_type,created_at) VALUES (?,?,?,?)",
    [blobHash, 1, "text/plain", timestamp]
  )
  const parentId = crypto.randomUUID()
  const versionId = crypto.randomUUID()
  persistence.database.run("INSERT INTO documents (id,kind,title,created_at) VALUES (?,?,?,?)", [
    parentId,
    "resume",
    "Parent",
    timestamp
  ])
  persistence.database.run(
    "INSERT INTO document_versions (id,document_id,version_number,blob_hash,created_at) VALUES (?,?,?,?,?)",
    [versionId, parentId, 1, blobHash, timestamp]
  )
  expect(() =>
    persistence.database.run(
      "INSERT INTO documents (id,kind,title,current_version_id,created_at) VALUES (?,?,?,?,?)",
      [crypto.randomUUID(), "resume", "Cross parent", versionId, timestamp]
    )
  ).toThrow("document version parent mismatch")
  expect(() =>
    persistence.database.run(
      "INSERT INTO documents (id,kind,title,current_version_id,created_at) VALUES (?,?,?,?,?)",
      [crypto.randomUUID(), "resume", "Dangling", crypto.randomUUID(), timestamp]
    )
  ).toThrow()
  expect(() =>
    persistence.database.run("INSERT INTO documents (id,kind,title,created_at) VALUES (?,?,?,?)", [
      crypto.randomUUID(),
      "resume",
      "Null current version",
      timestamp
    ])
  ).not.toThrow()
  persistence.close()
})

test("rejects job-post current-version cross-parent inserts while allowing repository flow", () => {
  const persistence = createTestPersistence()
  const parentId = crypto.randomUUID()
  const versionId = crypto.randomUUID()
  persistence.database.run(
    "INSERT INTO job_posts (id,title,company_name,created_at) VALUES (?,?,?,?)",
    [parentId, "Parent", "Example", timestamp]
  )
  persistence.database.run(
    "INSERT INTO job_post_versions (id,job_post_id,version_number,source_kind,structured_content,created_at) VALUES (?,?,?,?,?,?)",
    [versionId, parentId, 1, "manual", "{}", timestamp]
  )
  expect(() =>
    persistence.database.run(
      "INSERT INTO job_posts (id,title,company_name,current_version_id,created_at) VALUES (?,?,?,?,?)",
      [crypto.randomUUID(), "Cross parent", "Example", versionId, timestamp]
    )
  ).toThrow("job post version parent mismatch")
  const post = persistence.repositories.domain.createJobPost({
    id: crypto.randomUUID(),
    title: "Repository flow",
    companyName: "Example"
  })
  expect(() =>
    persistence.repositories.domain.addJobPostVersion({
      id: crypto.randomUUID(),
      jobPostId: post.id,
      sourceKind: "manual",
      content: {}
    })
  ).not.toThrow()
  persistence.close()
})
