import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { FileSystemEntry } from "../../../src/lib/api/sandbox-files.ts"
import {
  applyMentionCompletion,
  completeMentionQuery,
  filterMentionEntries,
  groupMentionEntries,
  mentionListPath,
  parseMentionTrigger,
  splitMentionQuery,
  visibleMentionEntries,
} from "../../../src/features/agent-message/composer-mention.ts"

const src: FileSystemEntry = {
  path: "/workspace/src",
  name: "src",
  type: "directory",
  size: null,
  modified: null,
  permissions: null,
}

const docs: FileSystemEntry = {
  path: "/workspace/docs",
  name: "docs",
  type: "directory",
  size: null,
  modified: null,
  permissions: null,
}

const readme: FileSystemEntry = {
  path: "/workspace/README.md",
  name: "README.md",
  type: "file",
  size: 12,
  modified: null,
  permissions: null,
}

describe("composer mention helpers", () => {
  it("parses an @ token after start or whitespace, but not emails", () => {
    assert.deepEqual(parseMentionTrigger("@"), { raw: "@", query: "" })
    assert.deepEqual(parseMentionTrigger("@src"), { raw: "@src", query: "src" })
    assert.deepEqual(parseMentionTrigger("see @src/lib"), {
      raw: "@src/lib",
      query: "src/lib",
    })
    assert.deepEqual(parseMentionTrigger("see @src/lib", "/foo"), {
      raw: "@src/lib/foo",
      query: "src/lib/foo",
    })
    assert.equal(parseMentionTrigger("hello"), null)
    assert.equal(parseMentionTrigger("user@host"), null)
    assert.equal(parseMentionTrigger("hello user@host"), null)
    assert.equal(parseMentionTrigger("/@src"), null)
  })

  it("splits the typed path into the current directory and filter", () => {
    assert.deepEqual(splitMentionQuery(""), { directory: "", filter: "" })
    assert.deepEqual(splitMentionQuery("src"), { directory: "", filter: "src" })
    assert.deepEqual(splitMentionQuery("src/"), { directory: "src", filter: "" })
    assert.deepEqual(splitMentionQuery("src/index"), {
      directory: "src",
      filter: "index",
    })
    assert.deepEqual(splitMentionQuery("src/lib/"), {
      directory: "src/lib",
      filter: "",
    })
  })

  it("completes a directory with a trailing slash and a file without closing slash", () => {
    assert.deepEqual(completeMentionQuery("s", "src", "directory"), {
      query: "src/",
      close: false,
    })
    assert.deepEqual(completeMentionQuery("src/", "lib", "directory"), {
      query: "src/lib/",
      close: false,
    })
    assert.deepEqual(completeMentionQuery("src/in", "index.ts", "file"), {
      query: "src/index.ts",
      close: true,
    })
    assert.deepEqual(completeMentionQuery("", "README.md", "file"), {
      query: "README.md",
      close: true,
    })
  })

  it("replaces only the active @ token when completing", () => {
    assert.equal(applyMentionCompletion("@s", "src/"), "@src/")
    assert.equal(applyMentionCompletion("see @src", "src/"), "see @src/")
    assert.equal(
      applyMentionCompletion("see @src/in", "src/index.ts"),
      "see @src/index.ts"
    )
  })

  it("filters the current level by name prefix then contains", () => {
    assert.deepEqual(
      filterMentionEntries([src, docs, readme], "sr").map((entry) => entry.name),
      ["src"]
    )
    assert.deepEqual(
      filterMentionEntries([src, docs, readme], "s").map((entry) => entry.name),
      ["src", "docs"]
    )
    assert.deepEqual(
      filterMentionEntries([src, docs, readme], "md").map((entry) => entry.name),
      ["README.md"]
    )
    assert.equal(filterMentionEntries([src, docs, readme], "").length, 3)
  })

  it("groups folders before files so Tab completes the first visible row", () => {
    assert.deepEqual(
      visibleMentionEntries([readme, src]).map((entry) => entry.name),
      ["src", "README.md"]
    )
    assert.deepEqual(groupMentionEntries([readme, src]), [
      { kind: "directory", entries: [src] },
      { kind: "file", entries: [readme] },
    ])
    assert.equal(mentionListPath("/workspace", ""), "/workspace")
    assert.equal(mentionListPath("/workspace", "src/lib"), "/workspace/src/lib")
    assert.equal(
      mentionListPath("/Users/me/project", "agent-ui/src"),
      "/Users/me/project/agent-ui/src"
    )
  })
})
