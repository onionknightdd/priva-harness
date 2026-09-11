import assert from "node:assert/strict"
import { test } from "node:test"
import { SessionStream } from "../../../../services/agent-runner/ts/src/harness/session/session-stream"
import type { AgentEvent } from "../../../../services/agent-runner/ts/src/core/event/agent-event"
import { ClaudeEventMapper, type ClaudeSdkMessage } from "../../../../services/agent-runner/ts/src/provider/claude/claude-event-mapper"
import { transcriptThreadRecords } from "../../../../services/agent-runner/ts/src/provider/claude/session/claude-transcript"
import { applyThreadStreamFrame, type StreamFrame } from "../../../src/features/agent-message/run-stream-reducer"
import { assistantTimeline } from "../../../src/features/agent-message/assistant-timeline"
import { agentToolsForMessage, agentToolsForThread } from "../../../src/features/agent-message/agent-tool-data"
import { threadMessagesFromApi } from "../../../src/features/chat-session/session-thread-messages"
import type { AgentThreadMessage } from "../../../src/features/agent-message/agent-message-data"

test("an absorbed batch starts one independent streaming turn and keeps its Agent output available across turns", () => {
  const stream = new SessionStream({ provider: "claude", id: "session" })
  const mapper = new ClaudeEventMapper()
  let messages: AgentThreadMessage[] = []
  const send = (event: AgentEvent, runId = "human-run") => {
    const frame = JSON.parse(JSON.stringify(stream.publish(event, runId))) as StreamFrame
    messages = applyThreadStreamFrame(messages, runId, frame)
  }
  const native = (record: unknown) => {
    for (const normalized of transcriptThreadRecords([JSON.stringify(record)])) {
      for (const event of mapper.push(normalized as ClaudeSdkMessage)) send(event)
    }
  }
  const task = (id: number) => ({ taskId: `worker-${id}`, toolUseId: `tool-${id}`, kind: "agent" as const, status: "running" as const })
  send({ type: "run.started" }, "launch")
  send({ type: "assistant.message", messageId: "launch-model", blocks: [1, 2].map((id) => ({
    type: "tool_use", id: `tool-${id}`, blockId: `tool-${id}`, index: id, name: "Agent", input: { description: `Worker ${id}` },
  })) }, "launch")
  for (const id of [1, 2]) send({ type: "task.updated", task: task(id) }, "launch")
  send({ type: "run.completed", model: "model", durationMs: 1 }, "launch")
  send({ type: "run.started", userMessage: { id: "human", role: "user", content: "Check progress", status: "complete", createdAt: new Date(1).toISOString() } })
  native({ type: "assistant", message: { id: "checking", content: [{ type: "text", text: "Checking now" }] } })
  const absorbed = (id: number, uuid = `notice-${id}`, result = `Actual result ${id}`) => ({ type: "attachment", uuid, attachment: {
    type: "queued_command", commandMode: "task-notification",
    prompt: `<task-notification><task-id>worker-${id}</task-id><tool-use-id>tool-${id}</tool-use-id><status>completed</status><result>${result}</result></task-notification>`,
  } })
  native(absorbed(1))
  assert.equal(messages.find((message) => message.id === "human-run")?.status, "complete")
  assert.equal(messages.at(-1)?.id, "task-turn:notice-1")
  native(absorbed(2))
  native(absorbed(1))
  const beforeReply = stream.snapshot()
  assert.equal(beforeReply.activeRunId, "human-run")
  assert.equal(beforeReply.messages.at(-1)?.blocks?.length, 2)
  const sendModelFrame = (event: unknown) => {
    for (const mapped of mapper.push({ type: "stream_event", event })) send(mapped)
  }
  sendModelFrame({ type: "message_start", message: { id: "summary" } })
  sendModelFrame({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })
  sendModelFrame({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Both finished" } })
  assert.equal(messages.at(-1)?.content, "Both finished")
  assert.equal(messages.at(-1)?.status, "streaming")
  native({ type: "assistant", message: { id: "summary", content: [{ type: "text", text: "Both finished" }] } })
  assert.deepEqual(messages.map((message) => message.id), ["launch", "human", "human-run", "task-turn:notice-1"])
  assert.equal(messages[2]?.content, "Checking now")
  assert.equal(messages[0]?.blocks?.filter((block) => block.type === "task_notification").length, 0)
  native(absorbed(1, "later", "Resumed output"))
  native({ type: "assistant", message: { id: "later-summary", content: [{ type: "text", text: "Resumed worker finished" }] } })
  send({ type: "run.completed", model: "model", durationMs: 1 })
  assert.equal(messages[3]?.status, "complete")
  assert.equal(messages[4]?.status, "complete")
  const restored = threadMessagesFromApi(JSON.parse(JSON.stringify(stream.snapshot().messages)))
  const shape = (items: AgentThreadMessage[]) => items.map((message) => ({ id: message.id, status: message.status,
    sections: assistantTimeline(message).map((section) => [section.notification?.id, section.message.content]),
  }))
  assert.deepEqual(shape(restored), shape(messages))
  const worker = agentToolsForThread(restored).find((agent) => agent.id === "tool-1")!
  assert.equal(worker.output, "Resumed output")
  assert.deepEqual(worker.notifications.map((notification) => [notification.id, notification.task.result]),
    [["notice-1", "Actual result 1"], ["later", "Resumed output"]])
  assert.equal(stream.snapshot().activeRunId, undefined)
})

test("live deltas, completed snapshots, and reconnect snapshots keep a task reply in the launch bubble", () => {
  const stream = new SessionStream({ provider: "claude", id: "session" })
  let messages: AgentThreadMessage[] = []
  const send = (event: AgentEvent, runId = "") => {
    const frame = JSON.parse(JSON.stringify(stream.publish(event, runId))) as StreamFrame
    messages = applyThreadStreamFrame(messages, runId, frame)
  }
  const start = (runId: string) => send({ type: "run.started", userMessage: { id: `user-${runId}`, role: "user", content: runId, status: "complete", createdAt: new Date(1).toISOString() } }, runId)
  const end = (runId: string) => send({ type: "run.completed", model: "model", durationMs: 1 }, runId)
  const task = { taskId: "worker", toolUseId: "tool", kind: "agent" as const, status: "completed" as const, result: "Actual worker output" }
  start("launch")
  send({ type: "assistant.message", messageId: "model-launch", blocks: [
    { type: "tool_use", id: "tool", blockId: "tool", index: 0, name: "Agent", input: { description: "Worker" } },
    { type: "text", blockId: "launch-text", index: 1, text: "Started" },
  ] }, "launch")
  send({ type: "task.updated", task: { ...task, status: "running" } }, "launch")
  end("launch")
  start("human-reply")
  send({ type: "assistant.message", messageId: "model-human", blocks: [{ type: "text", blockId: "human-text", index: 0, text: "Human answer" }] }, "human-reply")
  end("human-reply")
  send({ type: "task.notification", task })
  assert.equal(messages.flatMap((message) => message.blocks ?? []).filter((block) => block.type === "task_notification").length, 0)
  send({ type: "task.delivered", task, notification: { id: "notice", task } })
  send({ type: "task.delivered", task, notification: { id: "notice", task } })
  const replyTo = { notificationIds: ["notice"], taskId: "worker", toolUseId: "tool" }
  send({ type: "run.started", replyTo }, "followup")
  send({ type: "assistant.block_start", messageId: "model-followup", blockId: "reply-text", kind: "text", index: 0, replyTo }, "followup")
  send({ type: "assistant.delta", messageId: "model-followup", blockId: "reply-text", index: 0, text: "Worker finished", replyTo }, "followup")
  assert.equal(messages[1]?.status, "streaming")
  assert.deepEqual(messages.map((message) => message.id), ["user-launch", "launch", "user-human-reply", "human-reply"])
  assert.equal(messages[3]?.content, "Human answer")
  send({ type: "assistant.message", messageId: "model-followup", blocks: [{ type: "text", blockId: "reply-text", index: 0, text: "Worker finished" }], replyTo }, "followup")
  end("followup")
  const timeline = assistantTimeline(messages[1]!)
  assert.deepEqual(timeline.map((section) => [section.notification?.id, section.message.content]), [[undefined, "Started"], ["notice", "Worker finished"]])
  const restored = threadMessagesFromApi(JSON.parse(JSON.stringify(stream.snapshot().messages)))
  assert.deepEqual(assistantTimeline(restored[1]!).map((section) => [section.notification?.id, section.message.content]), timeline.map((section) => [section.notification?.id, section.message.content]))
  assert.equal(agentToolsForMessage(restored[1]!)[0]?.output, "Actual worker output")
})

test("background agent output uses the native result instead of its launch receipt or nested transcript", () => {
  const task = { taskId: "task", kind: "agent" as const, status: "completed" as const, toolUseId: "call", result: "Native\nresult" }
  const message: AgentThreadMessage = { id: "launch", role: "assistant", status: "complete", content: "Main assistant summary", createdAt: "2026-01-01", blocks: [
    { type: "tool_use", id: "call", blockId: "call", index: 0, name: "Agent", tool: { id: "call", name: "agent", status: "completed", launchStatus: "async_launched", output: "Async agent launched successfully", backgroundTask: task } },
    { type: "task_notification", blockId: "notice", index: 1, notification: { id: "delivery", task } },
  ], nestedAgents: [{ parentToolUseId: "call", blocks: [{ type: "text", blockId: "internal", index: 0, text: "Internal progress" }], inbox: [], status: "completed" }] }
  const agent = agentToolsForMessage(message)[0]!
  assert.equal(agent.output, "Native\nresult")
  assert.equal(agent.state, "completed")
  assert.equal(agent.notifications[0]?.task.result, "Native\nresult")
  const noResult = structuredClone(message)
  const call = noResult.blocks![0]!
  if (call.type === "tool_use") delete call.tool!.backgroundTask!.result
  assert.equal(agentToolsForMessage(noResult)[0]?.output, undefined)
})
