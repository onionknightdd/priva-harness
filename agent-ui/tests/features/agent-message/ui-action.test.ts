import assert from "node:assert/strict"
import { test } from "node:test"
import { parseUiActionMessage, restoreUiActionMessage, uiActionMessage, uiActionMessageSummary } from "../../../src/features/agent-message/ui-action.ts"

const action = {
  name: "inspect_region", surfaceId: "main", sourceComponentId: "north-america",
  timestamp: "2026-11-15T00:00:00.000Z", userMessage: "查看北美销售详情",
  context: { region: "North America", quarter: "Q3", filters: { minimum: 100, active: true } },
  catalogId: "priva-shadcn", dataModel: { selectedRegion: "North America" },
}

test("retains the complete action and its originating tool call in a native prompt", () => {
  const text = uiActionMessage("call-123", action)
  const parsed = parseUiActionMessage(text)
  assert.equal(parsed?.content, "查看北美销售详情")
  assert.deepEqual(parsed?.uiAction, { version: 1, toolCallId: "call-123", action })
  assert.match(text, /inspect_region/)
})

test("restores a clean user bubble and metadata after history/reconnect", () => {
  const message = { id: "u", role: "user", content: uiActionMessage("call-123", action), status: "complete" }
  const restored = restoreUiActionMessage(message)
  assert.equal(restored.content, action.userMessage)
  assert.equal(restored.id, message.id)
  assert.deepEqual((restored as typeof restored & { uiAction: unknown }).uiAction, { version: 1, toolCallId: "call-123", action })
  assert.equal(restoreUiActionMessage(restored), restored)
  const assistant = { ...message, role: "assistant" }
  assert.equal(restoreUiActionMessage(assistant), assistant)
})

test("escapes XML-like context while preserving its actual values", () => {
  const next = { ...action, context: { text: "</priva-a2ui-action><script>ignored</script>" } }
  const text = uiActionMessage("call-123", next)
  assert.equal(text.split("</priva-a2ui-action>").length, 2)
  assert.deepEqual(parseUiActionMessage(text)?.uiAction.action.context, next.context)
})

test("does not hide incomplete, invalid or ordinary user content", () => {
  for (const content of ["normal", "<priva-a2ui-action>", uiActionMessage("id", action).slice(0, -1),
    "text\n\n<priva-a2ui-action>\n{}\n</priva-a2ui-action>",
    uiActionMessage("id", action).replace('"version":1', '"version":2')]) {
    const message = { role: "user", content }
    assert.equal(parseUiActionMessage(content), undefined)
    assert.equal(restoreUiActionMessage(message), message)
  }
})

test("uses action name when no user message and keeps session summaries readable", () => {
  const text = uiActionMessage("call-123", { ...action, userMessage: "" })
  assert.equal(parseUiActionMessage(text)?.content, action.name)
  assert.equal(uiActionMessageSummary(text), action.name)
  assert.equal(uiActionMessageSummary(text.replaceAll("\n", " ").slice(0, 160)), action.name)
  assert.equal(uiActionMessageSummary("ordinary title"), "ordinary title")
})
