import assert from "node:assert/strict"
import { test } from "node:test"

import { createGitDecorations, gitChangeStatus, groupGitChanges } from "../../../src/features/git/git-data.ts"
import type { GitChange, GitRepository } from "../../../src/lib/api/git-repository.ts"

const change = (path: string, indexStatus = " ", worktreeStatus = " ", extra: Partial<GitChange> = {}): GitChange => ({ path, indexStatus, worktreeStatus, originalPath: null, conflicted: false, ...extra })
const repository = (changes: GitChange[], root = "/workspace/repo"): GitRepository => ({
  cwd: root, root, branch: "main", commit: "a".repeat(40), upstream: null, remote: null, remotes: [], ahead: 0, behind: 0, operation: null, changes, branches: [],
})

test("groups partially staged files into both comparisons while conflicts stay exclusive", () => {
  const partial = change("partial.ts", "M", "M")
  const staged = change("staged.ts", "A")
  const unstaged = change("unstaged.ts", " ", "D")
  const untracked = change("untracked.ts", "?", "?")
  const conflicted = change("conflicted.ts", "U", "U", { conflicted: true })
  const clean = change("clean.ts", ".", ".")
  assert.deepEqual(groupGitChanges([partial, staged, unstaged, untracked, conflicted, clean]), {
    conflicted: [conflicted], staged: [partial, staged], unstaged: [partial, unstaged], untracked: [untracked],
  })
})

test("file decorations retain rename identity and aggregate both source and destination parents", () => {
  const decorations = createGitDecorations(repository([
    change("new/deep/file.ts", "R", "M", { originalPath: "old/file.ts" }),
    change("new/conflict.ts", "U", "U", { conflicted: true }),
    change("added.ts", "A", "M"),
  ]))
  assert.deepEqual(decorations.get("/workspace/repo/new/deep/file.ts"), { status: "R", kind: "file", conflicted: false })
  assert.deepEqual(decorations.get("/workspace/repo/old/file.ts"), { status: "D", kind: "file", conflicted: false })
  assert.deepEqual(decorations.get("/workspace/repo/old"), { status: ".", kind: "directory", conflicted: false })
  assert.deepEqual(decorations.get("/workspace/repo/new"), { status: ".", kind: "directory", conflicted: true })
  assert.deepEqual(decorations.get("/workspace/repo"), { status: ".", kind: "directory", conflicted: true })
  assert.equal(decorations.get("/workspace/repo/added.ts")?.status, "A")
  assert.equal(decorations.has("/workspace"), false)
})

test("renamed source decorations cannot overwrite a real changed path and root slash stays normalized", () => {
  const decorations = createGitDecorations(repository([
    change("new.ts", "R", " ", { originalPath: "old.ts" }),
    change("old.ts", "?", "?"),
    change("folder/child.ts", " ", "M"),
  ], "/"))
  assert.equal(decorations.get("/old.ts")?.status, "?")
  assert.equal(decorations.get("/")?.kind, "directory")
  assert.equal(decorations.get("/folder")?.kind, "directory")
  assert.equal([...decorations.keys()].some((key) => key.startsWith("//")), false)
  assert.equal(createGitDecorations(null).size, 0)
  assert.equal(createGitDecorations({ ...repository([]), root: null }).size, 0)
})

test("deletions, type changes and untracked files keep their meaningful status", () => {
  assert.equal(gitChangeStatus(change("deleted", "M", "D")), "D")
  assert.equal(gitChangeStatus(change("deleted", "D")), "D")
  assert.equal(gitChangeStatus(change("type", " ", "T")), "T")
  assert.equal(gitChangeStatus(change("new", "?", "?")), "?")
})
