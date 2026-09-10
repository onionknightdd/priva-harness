import assert from "node:assert/strict"
import { test } from "node:test"

import {
  emptyFileBrowserModel,
  getFileBrowserBreadcrumb,
  revealFileBrowserDirectory,
} from "../../../src/features/file-browser/file-browser-data.ts"

test("breadcrumbs stop at the workspace root", () => {
  assert.deepEqual(
    getFileBrowserBreadcrumb("/home/user/workspace/project/src", "/home/user/workspace").map((item) => item.path),
    ["/home/user/workspace", "/home/user/workspace/project", "/home/user/workspace/project/src"]
  )
  assert.deepEqual(getFileBrowserBreadcrumb("/home/user", "/home/user/workspace"), [])
  assert.deepEqual(getFileBrowserBreadcrumb("/home/user/workspace-other", "/home/user/workspace"), [])
})

test("workspace boundaries retain file names, filesystem roots and Windows drives", () => {
  assert.equal(getFileBrowserBreadcrumb("/work/file.txt", "/work", "file").at(-1)?.type, "file")
  assert.deepEqual(getFileBrowserBreadcrumb("/work", "/").map((item) => item.path), ["/", "/work"])
  assert.deepEqual(getFileBrowserBreadcrumb("C:\\work\\project", "C:\\work").map((item) => item.path), ["C:/work", "C:/work/project"])
})

test("revealing a deep directory creates ancestors only inside the workspace", () => {
  const model = revealFileBrowserDirectory(emptyFileBrowserModel, "/work/project/src", "/work")
  assert.equal(model.items["/work"].parentPath, null)
  assert.deepEqual(model.childrenByPath["/work"], ["/work/project"])
  assert.deepEqual(model.childrenByPath["/work/project"], ["/work/project/src"])
  assert.equal(model.items["/"], undefined)
  assert.deepEqual(revealFileBrowserDirectory(model, "/outside", "/work"), model)
})
