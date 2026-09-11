import assert from "node:assert/strict"
import { test } from "node:test"
import { connectAgentSession } from "../../../src/features/agent-message/run-agent-session.ts"
import { applyThreadStreamFrame } from "../../../src/features/agent-message/run-stream-reducer.ts"
import type { AgentThreadMessage } from "../../../src/features/agent-message/agent-message-data.ts"

class Socket extends EventTarget {
  static readonly OPEN = 1
  static readonly CONNECTING = 0
  static instances: Socket[] = []
  readyState = 0
  sent: Record<string, unknown>[] = []
  constructor(readonly url: string) { super(); Socket.instances.push(this) }
  open() { this.readyState = 1; this.dispatchEvent(new Event("open")) }
  send(text: string) { this.sent.push(JSON.parse(text)) }
  frame(frame: Record<string, unknown>) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ v: 2, streamId: "stream", harness: "claude", sessionId: "session", ...frame }) })) }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")) }
}

test("a response completion leaves the session connected for task notices and another response", async () => {
  const originals = ["window", "WebSocket"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { protocol: "http:", host: "localhost" } } })
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: Socket })
  const events: string[] = []
  const errors: string[] = []
  const connection = connectAgentSession({ harness: "claude" }, { onFrame: (frame) => events.push(frame.type ?? ""), onError: (error) => errors.push(error), onSession: () => {}, onConnection: () => {} })
  try {
    const socket = Socket.instances.at(-1)!
    const init = { text: "start", cwd: "/work", model: "model", harness: "claude" as const }
    const first = connection.start(init, "one")
    socket.open()
    assert.equal(socket.sent[0]?.type, "run.start")
    socket.frame({ type: "run.started", runId: "one", seq: 1 })
    socket.frame({ type: "run.completed", runId: "one", seq: 2 })
    await first
    assert.equal(socket.readyState, Socket.OPEN)
    await connection.waitForIdle()
    socket.frame({ type: "task.notification", seq: 3, task: { taskId: "job", status: "completed", kind: "bash" } })
    socket.frame({ type: "task.notification", seq: 3, task: { taskId: "job", status: "completed", kind: "bash" } })
    const second = connection.start({ ...init, text: "again" }, "two")
    socket.frame({ type: "run.started", runId: "two", seq: 4 })
    socket.frame({ type: "error", code: "task.stop", message: "Task no longer exists" })
    assert.deepEqual(errors, ["Task no longer exists"])
    socket.frame({ type: "run.completed", runId: "two", seq: 5 })
    await second
    assert.equal(events.filter((type) => type === "task.notification").length, 1)
    connection.stopTask("job")
    assert.deepEqual(socket.sent.at(-1), { type: "task.stop", harness: "claude", sessionId: "session", taskId: "job" })
    const uncertain = assert.rejects(connection.start(init, "uncertain"), /before the run could be confirmed/)
    socket.close()
    const queued = connection.start(init, "queued")
    await new Promise((resolve) => setTimeout(resolve, 350))
    const reconnected = Socket.instances.at(-1)!
    reconnected.open()
    assert.deepEqual(reconnected.sent[0], { type: "session.subscribe", harness: "claude", sessionId: "session", streamId: "stream", sinceSeq: 5 })
    assert.equal(reconnected.sent[1]?.runId, "queued")
    assert.equal(reconnected.sent.length, 2)
    reconnected.frame({ type: "session.snapshot", seq: 5, messages: [], tasks: [] })
    await uncertain
    reconnected.frame({ type: "run.started", seq: 6, runId: "queued" })
    reconnected.frame({ type: "run.completed", seq: 7, runId: "queued" })
    await queued
  } finally {
    connection.disconnect()
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key) }
  }
})

test("late task frames update the owning reply without changing the current reply", () => {
  const base = { role: "assistant" as const, content: "", createdAt: new Date(0).toISOString(), status: "complete" as const }
  const messages: AgentThreadMessage[] = [{ ...base, id: "old", blocks: [{ type: "tool_use", blockId: "tool", index: 0, id: "tool", name: "bash" }] }, { ...base, id: "new", status: "streaming" }]
  const next = applyThreadStreamFrame(messages, "new", { type: "task.notification", task: { taskId: "job", toolUseId: "tool", kind: "bash", status: "cancelled" } })
  assert.equal(next[0]?.blocks?.[0]?.type === "tool_use" && next[0].blocks[0].tool?.backgroundTask?.status, "cancelled")
  assert.equal(next[1]?.status, "streaming")
  assert.equal(next.length, 2)
})

test("interaction submission waits for acknowledgment, allows retry and never replays an uncertain decision", async () => {
  const originals = ["window", "WebSocket"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { protocol: "http:", host: "localhost" } } })
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: Socket })
  const connectionErrors: string[] = []
  const connection = connectAgentSession({ harness: "pi", sessionId: "session" }, { onFrame: () => {}, onError: (error) => connectionErrors.push(error), onSession: () => {}, onConnection: () => {} })
  const request = { kind: "tool", requestId: "one", tool: "extension", expiresAt: 100 }
  try {
    const socket = Socket.instances.at(-1)!
    await assert.rejects(connection.respondPermission({ requestId: "one", decision: "allow" }), /unavailable/)
    socket.open()
    socket.frame({ type: "permission.requested", request, seq: 1 })
    let acknowledged = false
    const sending = connection.respondPermission({ requestId: "one", decision: "allow" }).then(() => { acknowledged = true })
    await assert.rejects(connection.respondPermission({ requestId: "one", decision: "deny" }), /already being submitted/)
    assert.deepEqual(socket.sent.at(-1), { type: "permission.respond", harness: "pi", sessionId: "session", requestId: "one", decision: "allow" })
    assert.equal(acknowledged, false)
    const rejected = assert.rejects(sending, /Try again/)
    socket.frame({ type: "error", requestId: "one", code: "permission.respond", message: "Try again" })
    await rejected
    assert.deepEqual(connectionErrors, [])
    const retry = connection.respondPermission({ requestId: "one", decision: "deny" })
    socket.frame({ type: "permission.resolved", seq: 2, resolution: { request, decision: "deny", reason: "skipped" } })
    await retry
    const uncertain = assert.rejects(connection.respondPermission({ requestId: "two", decision: "allow" }), /before the response was confirmed/)
    socket.close()
    await uncertain
    await new Promise((resolve) => setTimeout(resolve, 350))
    const reconnected = Socket.instances.at(-1)!
    reconnected.open()
    assert.equal(reconnected.sent.length, 1)
    assert.equal(reconnected.sent[0]?.type, "session.subscribe")
  } finally {
    connection.disconnect()
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key) }
  }
})
