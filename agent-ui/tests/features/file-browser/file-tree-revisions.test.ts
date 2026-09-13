import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type {
  FileBrowserItem,
  FileBrowserModel,
} from "../../../src/features/file-browser/file-browser-data.ts"
import {
  createFileTreeRevisions,
  type FileTreeRevisionInputs,
} from "../../../src/features/file-browser/file-tree-revisions.ts"

const ROOT = "/root"

function item(path: string, type: FileBrowserItem["type"] = "folder"): FileBrowserItem {
  const segments = path.split("/")
  return {
    path,
    name: segments.at(-1) ?? path,
    type,
    size: null,
    modifiedAt: null,
    permissions: null,
    parentPath: path === ROOT ? null : segments.slice(0, -1).join("/"),
  }
}

function model(): FileBrowserModel {
  return {
    items: {
      [ROOT]: item(ROOT),
      "/root/a": item("/root/a"),
      "/root/a/x": item("/root/a/x"),
      "/root/a/x/deep.txt": item("/root/a/x/deep.txt", "file"),
      "/root/b": item("/root/b"),
      "/root/b/y.txt": item("/root/b/y.txt", "file"),
    },
    childrenByPath: {
      [ROOT]: ["/root/a", "/root/b"],
      "/root/a": ["/root/a/x"],
      "/root/a/x": ["/root/a/x/deep.txt"],
      "/root/b": ["/root/b/y.txt"],
    },
  }
}

function inputs(overrides: Partial<FileTreeRevisionInputs> = {}): FileTreeRevisionInputs {
  return {
    expandedItems: [ROOT],
    selectedItems: [],
    focusedItem: null,
    search: null,
    loadingDirectories: new Set(),
    model: model(),
    rootPath: ROOT,
    ...overrides,
  }
}

function snapshot(revisions: ReturnType<typeof createFileTreeRevisions>, paths: string[]) {
  return Object.fromEntries(paths.map((path) => [path, revisions.get(path)]))
}

// Revisions are counters; only whether a path moved matters to React.memo.
function changedPaths(before: Record<string, number>, after: Record<string, number>) {
  return Object.keys(after).filter((path) => before[path] !== after[path]).sort()
}

const ALL = [ROOT, "/root/a", "/root/a/x", "/root/a/x/deep.txt", "/root/b", "/root/b/y.txt"]

describe("file tree revisions", () => {
  it("starts every item at zero and does not bump on the first update", () => {
    const revisions = createFileTreeRevisions()
    revisions.update(inputs())
    assert.deepEqual(snapshot(revisions, ALL), Object.fromEntries(ALL.map((path) => [path, 0])))
  })

  it("bumps an expanded item and its ancestors but not siblings", () => {
    const revisions = createFileTreeRevisions()
    const base = inputs()
    revisions.update(base)
    revisions.update({ ...base, expandedItems: [ROOT, "/root/a/x"] })

    assert.deepEqual(snapshot(revisions, ALL), {
      [ROOT]: 1,
      "/root/a": 1,
      "/root/a/x": 1,
      "/root/a/x/deep.txt": 0,
      "/root/b": 0,
      "/root/b/y.txt": 0,
    })
  })

  it("bumps directories whose loading flag changed, in both directions", () => {
    const revisions = createFileTreeRevisions()
    const base = inputs()
    revisions.update(base)
    revisions.update({ ...base, loadingDirectories: new Set(["/root/b"]) })
    assert.equal(revisions.get("/root/b"), 1)
    assert.equal(revisions.get(ROOT), 1)
    assert.equal(revisions.get("/root/a"), 0)

    revisions.update({ ...base, loadingDirectories: new Set() })
    assert.equal(revisions.get("/root/b"), 2)
    assert.equal(revisions.get(ROOT), 2)
  })

  it("bumps only the directory whose children or item data changed", () => {
    const revisions = createFileTreeRevisions()
    const base = inputs()
    revisions.update(base)

    // Mirror the reducers: unchanged entries keep their identity.
    const next: FileBrowserModel = {
      items: { ...base.model.items, "/root/b/z.txt": item("/root/b/z.txt", "file") },
      childrenByPath: { ...base.model.childrenByPath, "/root/b": ["/root/b/y.txt", "/root/b/z.txt"] },
    }
    const before = snapshot(revisions, [...ALL, "/root/b/z.txt"])
    revisions.update({ ...base, model: next })

    assert.deepEqual(changedPaths(before, snapshot(revisions, [...ALL, "/root/b/z.txt"])), [
      ROOT,
      "/root/b",
      "/root/b/z.txt",
    ])

    const renamed: FileBrowserModel = { ...next, items: { ...next.items, "/root/a/x/deep.txt": { ...item("/root/a/x/deep.txt", "file"), size: 12 } } }
    const beforeRename = snapshot(revisions, ALL)
    revisions.update({ ...base, model: renamed })
    assert.deepEqual(changedPaths(beforeRename, snapshot(revisions, ALL)), [
      ROOT,
      "/root/a",
      "/root/a/x",
      "/root/a/x/deep.txt",
    ])
  })

  it("resolves ancestors of a removed item through the previous model", () => {
    const revisions = createFileTreeRevisions()
    const base = inputs()
    revisions.update(base)

    const { "/root/a/x/deep.txt": _removed, ...remainingItems } = base.model.items
    const next: FileBrowserModel = {
      items: remainingItems,
      childrenByPath: { ...base.model.childrenByPath, "/root/a/x": [] },
    }
    const before = snapshot(revisions, ALL)
    revisions.update({ ...base, model: next })

    assert.deepEqual(changedPaths(before, snapshot(revisions, ALL)), [
      ROOT,
      "/root/a",
      "/root/a/x",
      "/root/a/x/deep.txt",
    ])
  })

  it("bumps both the previously and newly focused or selected items", () => {
    const revisions = createFileTreeRevisions()
    const base = inputs({ focusedItem: "/root/a", selectedItems: ["/root/a"] })
    revisions.update(base)
    revisions.update({ ...base, focusedItem: "/root/b/y.txt", selectedItems: ["/root/b/y.txt"] })

    assert.equal(revisions.get("/root/a"), 1)
    assert.equal(revisions.get("/root/b/y.txt"), 1)
    assert.equal(revisions.get("/root/b"), 1)
    assert.equal(revisions.get("/root/a/x"), 0)
  })

  it("invalidates every item when the search changes", () => {
    const revisions = createFileTreeRevisions()
    const base = inputs()
    revisions.update(base)
    revisions.update({ ...base, search: "dee" })

    for (const path of ALL) assert.equal(revisions.get(path), 1, path)
    assert.equal(revisions.get("/never/seen"), 1)
  })

  it("is idempotent for repeated identical inputs", () => {
    const revisions = createFileTreeRevisions()
    const base = inputs()
    revisions.update(base)
    const expanded = { ...base, expandedItems: [ROOT, "/root/b"] }
    revisions.update(expanded)
    revisions.update(expanded)
    assert.equal(revisions.get("/root/b"), 1)
    assert.equal(revisions.get(ROOT), 1)
  })
})
