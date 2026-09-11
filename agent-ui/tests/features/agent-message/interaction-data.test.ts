import assert from "node:assert/strict"
import { test } from "node:test"
import { updateInteractions, type InteractionRequest, type InteractionResolution } from "../../../src/features/agent-message/interaction-data.ts"
import { threadMessagesFromApi } from "../../../src/features/chat-session/session-thread-messages.ts"
import { applyStreamFrame } from "../../../src/features/agent-message/run-stream-reducer.ts"
import { assistantTimeline } from "../../../src/features/agent-message/assistant-timeline.ts"
import type { AgentThreadMessage } from "../../../src/features/agent-message/agent-message-data.ts"

const first: InteractionRequest = { kind: "tool", tool: "Bash", requestId: "one", expiresAt: 100 }
const second: InteractionRequest = { ...first, requestId: "two" }

test("interaction replay is idempotent and a snapshot replaces the pending queue", () => {
  const pending = updateInteractions([], { type: "permission.requested", request: first })
  assert.equal(updateInteractions(pending, { type: "permission.requested", request: first }), pending)
  const both = updateInteractions(pending, { type: "permission.requested", request: second })
  assert.deepEqual(both, [first, second])
  assert.deepEqual(updateInteractions(both, { type: "permission.resolved", resolution: { request: first, decision: "deny", reason: "skipped" } }), [second])
  assert.deepEqual(updateInteractions(both, { type: "session.snapshot", interactions: [second] }), [second])
  assert.deepEqual(updateInteractions(both, { type: "session.snapshot", interactions: [] }), [])
})

test("answered questions survive history mapping and repeated acknowledgments without a tool block", () => {
  const message: AgentThreadMessage = { id: "run", role: "assistant", content: "", createdAt: new Date(0).toISOString(), status: "complete", blocks: [] }
  const resolution: InteractionResolution = { request: { ...first, kind: "question", toolUseId: "nested-tool", questions: [{ id: "q0", question: "Region?", options: [], multiSelect: false }] }, decision: "allow", reason: "answered", answers: { q0: { selected: [], text: '日本 -> "Tokyo"' } } }
  const answered = applyStreamFrame(message, { type: "permission.resolved", resolution })
  const repeated = applyStreamFrame(answered, { type: "permission.resolved", resolution })
  assert.equal(repeated.interactions?.length, 1)
  const restored = threadMessagesFromApi([repeated])[0]
  assert.deepEqual(restored.interactions, [resolution])
  assert.deepEqual(assistantTimeline(restored)[0].message.interactions, [resolution])
})
