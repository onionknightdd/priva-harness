import assert from "node:assert/strict"
import { afterEach, test } from "node:test"

import { GitRepositoryApiError, performGitAction, readGitCommit, readGitDiff, readGitHistory, readGitRepository } from "../../../src/lib/api/git-repository.ts"

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

test("repository reads preserve encoded directories, paths and immutable commit references", async () => {
  const requests: { url: URL; init?: RequestInit }[] = []
  globalThis.fetch = async (input, init) => {
    requests.push({ url: new URL(String(input), "http://localhost"), init })
    return Response.json({})
  }
  const cwd = "/workspace/a & b/中文"
  const signal = new AbortController().signal
  await readGitRepository(cwd, signal)
  await readGitHistory(cwd, { skip: 40, limit: 20 }, signal)
  await readGitCommit(cwd, "a".repeat(40), signal)
  await readGitDiff(cwd, { path: "src/++ ?#&.ts", area: "commit", commit: "b".repeat(40) }, signal)
  assert.deepEqual(requests.map(({ url }) => url.pathname), ["/api/sandbox/git/repository", "/api/sandbox/git/history", "/api/sandbox/git/commit", "/api/sandbox/git/diff"])
  for (const { url, init } of requests) {
    assert.equal(url.searchParams.get("cwd"), cwd)
    assert.equal(init?.signal, signal)
    assert.equal(init?.cache, "no-store")
  }
  assert.equal(requests[1]!.url.searchParams.get("skip"), "40")
  assert.equal(requests[1]!.url.searchParams.get("limit"), "20")
  assert.equal(requests[2]!.url.searchParams.get("commit"), "a".repeat(40))
  assert.equal(requests[3]!.url.searchParams.get("path"), "src/++ ?#&.ts")
  assert.equal(requests[3]!.url.searchParams.get("commit"), "b".repeat(40))
})

test("mutations preserve optimistic HEAD guards and cannot be aborted by navigation", async () => {
  const input = { cwd: "/repo", expectedBranch: "main", expectedCommit: null, action: "commit" as const, message: "A multiline\ncommit message" }
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/sandbox/git/action")
    assert.equal(init?.method, "POST")
    assert.equal(init?.signal, undefined)
    assert.deepEqual(JSON.parse(String(init?.body)), input)
    return Response.json({ repository: {}, message: "Committed" })
  }
  assert.equal((await performGitAction(input)).message, "Committed")
})

test("API errors retain server detail and HTTP status with a proxy HTML fallback", async () => {
  globalThis.fetch = async () => Response.json({ detail: "Repository HEAD changed. Refresh before retrying." }, { status: 409 })
  await assert.rejects(readGitRepository("/repo"), (error: unknown) => error instanceof GitRepositoryApiError && error.status === 409 && error.message.includes("HEAD changed"))
  globalThis.fetch = async () => new Response("<html>Unavailable</html>", { status: 502, statusText: "Bad Gateway" })
  await assert.rejects(readGitRepository("/repo"), /Bad Gateway/)
})
