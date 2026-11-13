import assert from "node:assert/strict"
import test from "node:test"
import { createHtmlPreviewDocument } from "../../../src/features/files/preview/renderers/html-preview-sandbox"
import { EMBED_RUNTIME, EMBED_STATE_CHANNEL, EMBED_EXPORT_CHANNEL, isEmbedExportMessage, isEmbedStateMessage } from "../../../src/features/whiteboard/whiteboard-embed-runtime"

test("embedded state only accepts its channel and serializable bounded messages", () => {
  assert.equal(isEmbedStateMessage({ channel: EMBED_STATE_CHANNEL, type: "ready" }), true)
  assert.equal(isEmbedStateMessage({ channel: EMBED_STATE_CHANNEL, type: "change", state: { votes: 4 } }), true)
  assert.equal(isEmbedStateMessage({ channel: "other", type: "change", state: {} }), false)
  assert.equal(isEmbedStateMessage({ channel: EMBED_STATE_CHANNEL, type: "change", state: "x".repeat(65_000) }), false)
  assert.equal(isEmbedStateMessage({ channel: EMBED_STATE_CHANNEL, type: "change", state: undefined }), false)
})
test("CSP and runtime precede even malformed HTML starting with script", () => {
  const html = `<script>fetch('https://outside.test')</script><head></head>`
  const result = createHtmlPreviewDocument(`<!doctype html><html><head></head><body>${html}</body></html>`, { code: EMBED_RUNTIME, nonce: "whiteboard-state-runtime" })
  assert.ok(result.indexOf("connect-src 'none'") < result.indexOf("fetch("))
  assert.ok(result.indexOf("window.whiteboard") < result.indexOf("fetch("))
  assert.ok(!result.includes("allow-same-origin"))
})

test("embedded export messages accept bounded PNG snapshots only on their own channel", () => {
  const message = { channel: EMBED_EXPORT_CHANNEL, type: "snapshot", requestId: "export-1", dataUrl: "data:image/png;base64,AAAA" }
  assert.equal(isEmbedExportMessage(message), true)
  assert.equal(isEmbedExportMessage({ ...message, channel: EMBED_STATE_CHANNEL }), false)
  assert.equal(isEmbedExportMessage({ ...message, dataUrl: "https://external.test/image.png" }), false)
  assert.equal(isEmbedExportMessage({ ...message, dataUrl: "data:image/svg+xml,<svg/>" }), false)
  assert.equal(isEmbedExportMessage({ ...message, requestId: "x".repeat(101) }), false)
  assert.equal(isEmbedExportMessage({ channel: EMBED_EXPORT_CHANNEL, requestId: "export-1", type: "capture-error", message: "Image unavailable" }), true)
})
