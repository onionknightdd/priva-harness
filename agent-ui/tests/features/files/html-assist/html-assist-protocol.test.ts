import assert from "node:assert/strict"
import { test } from "node:test"
import { parseHtmlAssistCommand, parseHtmlAssistEvent } from "../../../../src/features/files/html-assist/html-assist-protocol.ts"

const envelope = { channel: "html-assist", nonce: "nonce-example" }
const locator = { documentId: "doc-example", nodeId: "node-1", selectors: ["p"], tagName: "p", snapshotHash: "0123456789abcdef" }
const box = { surfaceIndex: 0, x: -20, y: 10, width: 100, height: 40 }
const target = { kind: "html", elementType: "element", label: "p", text: "text", coordinateSpace: "html-viewport-css-pixels", boxes: [box], locator, html: "<p>text</p>", ancestors: ["body"], textTruncated: false, htmlTruncated: false }

test("bridge accepts only bounded pure-data commands and known fields", () => {
  assert.deepEqual(parseHtmlAssistCommand({ ...envelope, type: "validate", requestId: "check-1", locators: [locator] }), { ...envelope, type: "validate", requestId: "check-1", locators: [locator] })
  assert.ok(parseHtmlAssistCommand({ ...envelope, type: "reset-hover" }))
  assert.ok(parseHtmlAssistCommand({ ...envelope, type: "clear-reference" }))
  for (const value of [null, {}, { ...envelope, nonce: "" }, { ...envelope, type: "enable", enabled: true, injected: "unknown" }, { ...envelope, type: "items", nodeIds: Array.from({ length: 201 }, () => "node-1") }, { ...envelope, type: "reveal", requestId: "r", locator: { ...locator, selectors: [""] } }, { ...envelope, type: "validate", requestId: "r", locators: [{ ...locator, nodeId: "../node" }] }]) assert.equal(parseHtmlAssistCommand(value), null)
})

test("bridge rejects malformed nested snapshots and invalid geometry without throwing", () => {
  assert.ok(parseHtmlAssistEvent({ ...envelope, type: "lock", requestId: "pointer-1", target }))
  assert.ok(parseHtmlAssistEvent({ ...envelope, type: "focus-menu" }))
  const badTargets = [
    { ...target, unexpected: true },
    { ...target, html: "" },
    { ...target, text: "x".repeat(4001) },
    { ...target, htmlTruncated: "false" },
    { ...target, boxes: [{ ...box, width: 0 }] },
    { ...target, boxes: [{ ...box, x: Infinity }] },
    { ...target, locator: { ...locator, snapshotHash: "not-a-hash" } },
    { ...target, locator: { ...locator, selectors: Array(17).fill("p") } },
    { ...target, ancestors: Array(9).fill("main") },
  ]
  for (const invalid of badTargets) assert.equal(parseHtmlAssistEvent({ ...envelope, type: "lock", requestId: "pointer-1", target: invalid }), null)
  assert.equal(parseHtmlAssistEvent({ ...envelope, type: "invalid", nodeIds: ["node-1"], reason: { toString: null } }), null)
  assert.equal(parseHtmlAssistEvent({ ...envelope, type: "geometry", nodes: [{ nodeId: "node-1", box: { ...box, surfaceIndex: 1 } }] }), null)
})
