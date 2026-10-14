import assert from "node:assert/strict"
import { test } from "node:test"

import type { ThreadMessage } from "../../../../services/agent-runner/ts/src/core/resource/thread.ts"
import { foldThread } from "../../../../services/agent-runner/ts/src/core/resource/fold-thread.ts"
import { SessionStream } from "../../../../services/agent-runner/ts/src/harness/session/session-stream.ts"
import { replayPiSessionMessages } from "../../../../services/agent-runner/ts/src/provider/pi/pi-thread-replay.ts"
import type { SessionMessage } from "../../../../services/agent-runner/ts/src/core/resource/session.ts"
import type { AgentThreadMessage } from "../../../src/features/agent-message/agent-message-data.ts"
import { applyThreadStreamFrame, mergeSnapshotMessages, parseStreamFrame } from "../../../src/features/agent-message/run-stream-reducer.ts"
import { foldCommandSurfaces } from "../../../src/features/agent-message/slash-command-envelope.ts"

const at = "2026-10-14T00:00:00.000Z"
const user = (runId: string, content: string, createdAt = at): ThreadMessage => ({ id: `${runId}:user`, role: "user", content, status: "complete", createdAt })

/** Mirror the hook's snapshot/pending-command rules after the real JSON transport boundary. */
function client(stream: SessionStream) {
  let messages: AgentThreadMessage[] = []
  const pending = new Set<string>()
  let activeRunId: string | undefined
  const receive = (raw: unknown) => {
    const frame = parseStreamFrame(JSON.parse(JSON.stringify(raw)))
    assert.ok(frame)
    if (frame.type === "session.snapshot") {
      const snapshot = mergeSnapshotMessages(messages, frame.messages ?? [])
      const ids = new Set(snapshot.flatMap((message) => [message.id, message.renderId ?? message.id]))
      messages = [...snapshot, ...messages.filter((message) => !ids.has(message.id) &&
        (pending.has(message.id) || pending.has(message.id.replace(/:user$/, ""))))]
      activeRunId = frame.activeRunId
      return
    }
    if (frame.type === "run.started" && frame.runId) {
      if (frame.driver === "terminal") pending.delete(frame.runId)
      activeRunId = frame.runId
    }
    if (frame.type === "session.state" || frame.type === "error") return
    messages = applyThreadStreamFrame(messages, frame.runId ?? "", frame)
    if (["run.completed", "run.failed", "run.aborted"].includes(frame.type ?? "")) {
      if (frame.runId) pending.delete(frame.runId)
      if (activeRunId === frame.runId) activeRunId = undefined
    }
  }
  stream.subscribe(receive)
  return {
    get messages() { return messages },
    get activeRunId() { return activeRunId },
    receive,
    queue(runId: string, content = "/compact") {
      pending.add(runId)
      messages = [...messages,
        { ...user(runId, content), ...(content.startsWith("/compact") ? { compact: { phase: "queued" as const } } : {}) },
        { id: runId, role: "assistant", content: "", status: "streaming", createdAt: at },
      ]
    },
  }
}

const delta = (text: string, blockId: string) => ({ type: "assistant.delta" as const, messageId: `native:${blockId}`, blockId, index: 0, text })
const markerOf = (messages: readonly AgentThreadMessage[]) => messages.find((message) => message.compact)

test("real automatic compaction frames retain position and state through continuation, history and reconnect", () => {
  const stream = new SessionStream({ provider: "pi", id: "fixture-auto" })
  const ui = client(stream)
  ui.queue("run", "Continue the task")
  stream.startTerminalTurn("run", "fixture", user("run", "Continue the task"), false, true)
  stream.publish(delta("Before compaction", "before"), "run")
  const start = stream.publish({ type: "session.compacting", reason: "auto" }, "run")
  assert.ok(start.compactMessage)
  const markerId = start.compactMessage.id
  assert.deepEqual(ui.messages.map((message) => message.id), ["run:user", "run", markerId])
  assert.equal(markerOf(ui.messages)?.compact?.phase, "compacting")
  stream.publish({ type: "session.compacted", reason: "auto", summary: "Saved context" }, "run")
  assert.equal(ui.activeRunId, "run")
  assert.equal(ui.messages.find((message) => message.id === "run")?.status, "streaming")
  assert.equal(markerOf(ui.messages)?.compact?.phase, "compacted")
  stream.publish(delta("After compaction", "after"), "run")
  assert.deepEqual(ui.messages.map((message) => message.content), ["Continue the task", "Before compaction", "/compact", "After compaction"])
  assert.equal(ui.messages[1]?.status, "complete")
  assert.equal(ui.messages[3]?.status, "streaming")
  stream.publish({ type: "run.completed", model: "fixture", durationMs: 0 }, "run")
  assert.equal(ui.activeRunId, undefined)
  assert.equal(ui.messages[3]?.status, "complete")

  const native = (type: SessionMessage["type"], uuid: string, message: unknown): SessionMessage => ({
    type, uuid, sessionId: "fixture-auto", message, parentToolUseId: null, metadata: null, timestamp: Date.parse(at),
  })
  const history = foldThread(replayPiSessionMessages([
    native("user", "native-user", { role: "user", content: "Continue the task" }),
    native("assistant", "native-before", { role: "assistant", content: [{ type: "text", text: "Before compaction" }] }),
    native("compaction", "native-compact", { role: "compactionSummary", summary: "Saved context" }),
    native("assistant", "native-after", { role: "assistant", content: [{ type: "text", text: "After compaction" }] }),
  ]))
  assert.equal(stream.replaceHistory(history), true)
  assert.equal(markerOf(ui.messages)?.id, "native-compact")
  assert.equal(markerOf(ui.messages)?.renderId, markerId)
  assert.equal(markerOf(ui.messages)?.compact?.phase, "compacted")
  assert.deepEqual(foldCommandSurfaces(ui.messages).map((message) => message.content), ["Continue the task", "Before compaction", "/compact", "After compaction"])
  const reconnect = client(stream)
  assert.deepEqual(reconnect.messages, ui.messages)
})

test("real continuation remains before optimistic queued input", () => {
  const stream = new SessionStream({ provider: "pi", id: "fixture-auto-queued" })
  const ui = client(stream)
  stream.startTerminalTurn("run", "fixture", user("run", "Work"), false, true)
  stream.publish(delta("Before", "before"), "run")
  ui.queue("queued")
  stream.publish({ type: "session.compacting", reason: "auto" }, "run")
  stream.publish({ type: "session.compacted", reason: "auto", summary: "Context" }, "run")
  stream.publish(delta("Continuation", "after"), "run")
  assert.deepEqual(foldCommandSurfaces(ui.messages).map((message) => message.content), ["Work", "Before", "/compact", "Continuation", "/compact"])
  assert.equal(ui.messages.find((message) => message.id === "queued:user")?.compact?.phase, "queued")
})

test("real manual completion metadata and snapshots do not complete a second queued compact", () => {
  const stream = new SessionStream({ provider: "pi", id: "fixture-manual" })
  const ui = client(stream)
  ui.queue("first")
  ui.queue("second")
  stream.startTerminalTurn("first", "fixture", user("first", "/compact"), false, true)
  stream.publish({ type: "session.compacting", reason: "manual" }, "first")
  const completed = stream.publish({ type: "session.compacted", reason: "manual", summary: "First summary" }, "first")
  assert.equal(completed.compactMessage?.id, "first:user")
  ui.receive(stream.snapshot())
  assert.equal(ui.messages.find((message) => message.id === "first:user")?.compact?.phase, "compacted")
  assert.equal(ui.messages.find((message) => message.id === "second:user")?.compact?.phase, "queued")
  stream.publish({ type: "run.completed", model: "fixture", durationMs: 0 }, "first")
  stream.startTerminalTurn("second", "fixture", user("second", "/compact", "2026-10-14T00:00:01.000Z"), false, true)
  stream.publish({ type: "session.compacting", reason: "manual" }, "second")
  assert.equal(ui.messages.find((message) => message.id === "second:user")?.compact?.phase, "compacting")
  stream.publish({ type: "run.aborted", message: "Interrupted" }, "second")
  ui.receive(stream.snapshot())
  assert.equal(ui.messages.find((message) => message.id === "first:user")?.compact?.summary, "First summary")
  assert.equal(ui.messages.find((message) => message.id === "second:user")?.compact?.phase, "cancelled")
  assert.equal(ui.messages.filter((message) => message.compact).length, 2)
})
