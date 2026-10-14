import assert from "node:assert/strict"
import { test } from "node:test"

import type { AgentThreadMessage } from "../../../src/features/agent-message/agent-message-data.ts"
import { applyThreadStreamFrame } from "../../../src/features/agent-message/run-stream-reducer.ts"
import { foldCommandSurfaces, userMessageSurface } from "../../../src/features/agent-message/slash-command-envelope.ts"

const createdAt = "2026-10-14T00:00:00.000Z"
const user = (id: string, content: string): AgentThreadMessage => ({ id, role: "user", content, status: "complete", createdAt })
const assistant = (id: string): AgentThreadMessage => ({ id, role: "assistant", content: "Working", status: "streaming", createdAt })
const queued = (runId: string): AgentThreadMessage => ({ ...user(`${runId}:user`, "/compact"), compact: { phase: "queued" } })

test("queued manual compaction starts only when its own run starts", () => {
  const next = applyThreadStreamFrame([queued("first"), assistant("first"), queued("second"), assistant("second")], "first", {
    type: "run.started", runId: "first", userMessage: user("first:user", "/compact"),
  })
  assert.equal(next[0]?.compact?.phase, "compacting")
  assert.equal(next[2]?.compact?.phase, "queued")
})

test("manual completion and cancellation address their run despite queued commands", () => {
  let next = [queued("first"), assistant("first"), queued("second"), assistant("second")]
  next = applyThreadStreamFrame(next, "first", { type: "session.compacting" })
  next = applyThreadStreamFrame(next, "first", { type: "session.compacted", summary: "First result" })
  assert.equal(next[0]?.compact?.phase, "compacted")
  assert.equal(next[1]?.status, "streaming")
  assert.equal(next[2]?.compact?.phase, "queued")
  next = applyThreadStreamFrame(next, "second", { type: "run.aborted", message: "Interrupted" })
  assert.deepEqual(next[2]?.compact, { phase: "cancelled", message: "Interrupted" })
  assert.equal(next[3]?.status, "complete")
  assert.equal(next[0]?.compact?.phase, "compacted")
  assert.equal(foldCommandSurfaces(next)[2]?.compact?.phase, "cancelled")
})

test("a failed send settles its optimistic compact marker and a retry is independent", () => {
  let next = applyThreadStreamFrame([queued("failed"), assistant("failed"), queued("retry"), assistant("retry")], "failed", {
    type: "run.failed", message: "Connection closed before acceptance",
  })
  assert.deepEqual(next[0]?.compact, { phase: "failed", message: "Connection closed before acceptance" })
  assert.equal(next[1]?.status, "error")
  assert.equal(userMessageSurface(next[0]!.content, next[0]?.compact), "conversation-compacted")
  next = applyThreadStreamFrame(next, "retry", { type: "session.compacting" })
  next = applyThreadStreamFrame(next, "retry", { type: "session.compacted", summary: "Retry success" })
  assert.equal(next[0]?.compact?.phase, "failed")
  assert.equal(next[2]?.compact?.phase, "compacted")
})

test("automatic compaction inserts after its explicit anchor before queued commands", () => {
  const active = { ...assistant("native"), renderId: "active" }
  const marker: AgentThreadMessage = { ...user("auto:1", "/compact"), compact: { phase: "compacting" } }
  const next = applyThreadStreamFrame([user("u1", "Work"), active, queued("later"), assistant("later")], "active", {
    type: "session.compacting", reason: "auto", compactMessage: marker, compactAfterMessageId: "active",
  })
  assert.deepEqual(next.map((message) => message.id), ["u1", "native", "auto:1", "later:user", "later"])
  assert.equal(next[3]?.compact?.phase, "queued")
})

test("automatic completion stays at its original position and leaves the reply streaming", () => {
  const marker: AgentThreadMessage = { ...user("auto:1", "/compact"), compact: { phase: "compacting" } }
  const current = [user("u1", "Work"), assistant("active"), marker, queued("later"), assistant("later")]
  const next = applyThreadStreamFrame(current, "active", {
    type: "session.compacted", reason: "auto", compactMessage: { ...marker, compact: { phase: "compacted", summary: "Auto summary" } },
    compactAfterMessageId: "later",
  })
  assert.deepEqual(next.map((message) => message.id), current.map((message) => message.id))
  assert.equal(next[1]?.status, "streaming")
  assert.equal(next[2]?.compact?.summary, "Auto summary")
  assert.equal(next[3]?.compact?.phase, "queued")
  assert.equal(applyThreadStreamFrame(next, "active", { type: "run.completed" })[1]?.status, "complete")
})

test("a marker updates by render identity without duplicating its optimistic command", () => {
  const marker = { ...queued("run"), compact: { phase: "compacting" as const } }
  const next = applyThreadStreamFrame([marker, assistant("run")], "run", {
    type: "session.compacted", compactMessage: { ...marker, id: "native-user", renderId: marker.id, compact: { phase: "compacted" } },
  })
  assert.equal(next.length, 2)
  assert.equal(next[0]?.id, "native-user")
  assert.equal(next[0]?.renderId, "run:user")
  assert.equal(next[0]?.compact?.phase, "compacted")
})

test("a marker failure is separate from the foreground run outcome", () => {
  for (const [type, phase] of [["session.compaction_failed", "failed"], ["session.compaction_cancelled", "cancelled"]] as const) {
    const marker: AgentThreadMessage = { ...user("auto", "/compact"), compact: { phase: "compacting" } }
    const next = applyThreadStreamFrame([assistant("run"), marker], "run", {
      type, message: "Summarization stopped", compactMessage: { ...marker, compact: { phase, message: "Summarization stopped" } },
    })
    assert.equal(next[0]?.status, "streaming")
    assert.equal(next[1]?.compact?.phase, phase)
  }
})

test("run failure uses explicit marker metadata even with a different message target", () => {
  const marker: AgentThreadMessage = { ...user("manual", "/compact"), compact: { phase: "compacting" } }
  const next = applyThreadStreamFrame([marker, assistant("native"), queued("future")], "run", {
    type: "run.failed", messageTargetId: "native", message: "Failed", compactMessage: { ...marker, compact: { phase: "failed", message: "Failed" } },
  })
  assert.equal(next[0]?.compact?.phase, "failed")
  assert.equal(next[1]?.status, "error")
  assert.equal(next[2]?.compact?.phase, "queued")
})

test("raw automatic events and unrelated runs never rewrite an old or queued manual marker", () => {
  const marker: AgentThreadMessage = { ...user("old", "/compact"), compact: { phase: "compacted", summary: "Old summary" } }
  const current = [marker, user("active:user", "Continue"), assistant("active"), queued("future"), assistant("future")]
  for (const frame of [{ type: "session.compacting", reason: "auto" as const }, { type: "session.compacted" }, { type: "run.failed", message: "Unrelated failure" }]) {
    const next = applyThreadStreamFrame(current, "active", frame)
    assert.deepEqual(next[0]?.compact, marker.compact)
    assert.equal(next[3]?.compact?.phase, "queued")
  }
})

test("a repeated start cannot revert the same marker after completion", () => {
  const marker: AgentThreadMessage = { ...user("marker", "/compact"), compact: { phase: "compacted", summary: "Saved summary" } }
  const next = applyThreadStreamFrame([marker], "run", { type: "session.compacting", compactMessage: { ...marker, compact: { phase: "compacting" } } })
  assert.deepEqual(next[0]?.compact, marker.compact)
})
