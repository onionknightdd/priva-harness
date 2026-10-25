import assert from "node:assert/strict"
import test from "node:test"
import { parseGitDiff, splitGitDiff } from "../../../src/features/git/git-diff-lines"

test("unified diff preserves hunk positions, empty content, and metadata", () => {
  const lines = parseGitDiff("diff --git a/a.ts b/a.ts\nindex 123..456 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -8,3 +8,3 @@ function run\n context\n-old\n+new\n \n@@ -22 +22,2 @@\n-last\n+next\n+extra\n\\ No newline at end of file\n")
  assert.deepEqual(lines.filter((line) => ["context", "added", "removed"].includes(line.kind)), [
    { kind: "context", text: "context", oldLine: 8, newLine: 8 },
    { kind: "removed", text: "old", oldLine: 9 },
    { kind: "added", text: "new", newLine: 9 },
    { kind: "context", text: "", oldLine: 10, newLine: 10 },
    { kind: "removed", text: "last", oldLine: 22 },
    { kind: "added", text: "next", newLine: 22 },
    { kind: "added", text: "extra", newLine: 23 },
  ])
  assert.equal(lines.at(-1)?.text, "\\ No newline at end of file")
  assert.equal(lines.filter((line) => line.kind === "hunk").length, 2)
})

test("content that resembles headers remains code inside a hunk", () => {
  assert.deepEqual(parseGitDiff("@@ -1 +1 @@\n--- old content\n+++ new content\n").slice(1), [
    { kind: "removed", text: "-- old content", oldLine: 1 },
    { kind: "added", text: "++ new content", newLine: 1 },
  ])
})

test("split diff pairs replacements without losing unmatched additions or hunk boundaries", () => {
  const rows = splitGitDiff(parseGitDiff("@@ -1,2 +1,3 @@\n-one\n+two\n+three\n end\n"))
  assert.equal(rows[0].heading?.kind, "hunk")
  assert.equal(rows[1].left?.text, "one")
  assert.equal(rows[1].right?.text, "two")
  assert.equal(rows[2].left, undefined)
  assert.equal(rows[2].right?.text, "three")
  assert.equal(rows[3].left?.oldLine, 2)
  assert.equal(rows[3].right?.newLine, 3)
})

test("empty, binary, mode-only and combined diff do not manufacture line numbers", () => {
  assert.deepEqual(parseGitDiff(""), [])
  assert.ok(parseGitDiff("old mode 100644\nnew mode 100755\n").every((line) => line.kind === "meta"))
  assert.ok(parseGitDiff("Binary files a/x and b/x differ\n").every((line) => line.kind === "meta"))
  const combined = parseGitDiff("diff --cc a\n@@@ -1,1 -1,1 +1,2 @@@\n++conflict\n")
  assert.ok(combined.every((line) => line.oldLine === undefined && line.newLine === undefined))
})
