import assert from "node:assert/strict"
import test from "node:test"
import { updatePromptSuggestion } from "../../../src/features/agent-message/prompt-suggestion.ts"

test("native suggestions survive snapshots without restoring dismissed hints", () => {
  const frame = { type: "suggestion.prompts", prompts: ["检查子 agent 的输出"] }
  const suggestion = updatePromptSuggestion(null, "claude:one", frame)!
  assert.deepEqual(suggestion, { scope: "claude:one", text: frame.prompts[0], dismissed: false })
  const dismissed = { ...suggestion, dismissed: true }
  assert.equal(updatePromptSuggestion(dismissed, "claude:one", { ...frame, type: "session.snapshot" }), dismissed)
  assert.deepEqual(updatePromptSuggestion(dismissed, "claude:two", frame), { ...suggestion, scope: "claude:two" })
  assert.deepEqual(updatePromptSuggestion(dismissed, "claude:one", { ...frame, prompts: ["new hint"] }), { ...suggestion, text: "new hint" })
})

test("new turns, rebinding, empty snapshots and missing native hints clear suggestions", () => {
  const suggestion = { scope: "claude:one", text: "hint", dismissed: false }
  for (const frame of [
    { type: "run.started" }, { type: "session.rebound" }, { type: "session.snapshot" },
    { type: "session.snapshot", activeRunId: "busy", prompts: ["stale"] },
    { type: "suggestion.prompts", prompts: [] },
  ]) assert.equal(updatePromptSuggestion(suggestion, "claude:one", frame), null)
  assert.equal(updatePromptSuggestion(suggestion, "claude:one", { type: "session.config" }), suggestion)
})
