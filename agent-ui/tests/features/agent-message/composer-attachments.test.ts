import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  createComposerAttachments,
  formatComposerAttachmentSize,
  isImageAttachment,
} from "../../../src/features/agent-message/composer-attachments.ts"

describe("createComposerAttachments", () => {
  it("maps selected files into composer attachments", () => {
    const files = [
      new File(["hello"], "note.txt", { type: "text/plain" }),
      new File(["png"], "shot.png", { type: "image/png" }),
    ]

    const attachments = createComposerAttachments(files)

    assert.equal(attachments.length, 2)
    assert.equal(attachments[0]?.file.name, "note.txt")
    assert.equal(attachments[0]?.previewUrl, null)
    assert.equal(attachments[1]?.file.name, "shot.png")
    assert.notEqual(attachments[0]?.id, attachments[1]?.id)
  })

  it("returns an empty list when no files are selected", () => {
    assert.deepEqual(createComposerAttachments([]), [])
  })
})

describe("isImageAttachment", () => {
  it("detects image MIME types", () => {
    assert.equal(
      isImageAttachment(new File(["x"], "a.png", { type: "image/png" })),
      true
    )
    assert.equal(
      isImageAttachment(new File(["x"], "a.txt", { type: "text/plain" })),
      false
    )
  })
})

describe("formatComposerAttachmentSize", () => {
  it("formats bytes, kilobytes, and megabytes", () => {
    assert.equal(formatComposerAttachmentSize(512), "512 B")
    assert.equal(formatComposerAttachmentSize(1536), "1.5 KB")
    assert.equal(formatComposerAttachmentSize(2 * 1024 * 1024), "2.0 MB")
  })
})
