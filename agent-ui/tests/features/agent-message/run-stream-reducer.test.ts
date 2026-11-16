import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { AgentEvent } from "../../../../services/agent-runner/ts/src/core/event/agent-event.ts"
import { SessionStream } from "../../../../services/agent-runner/ts/src/harness/session/session-stream.ts"
import { PiEventMapper } from "../../../../services/agent-runner/ts/src/provider/pi/pi-event-mapper.ts"
import type { AgentThreadMessage, StreamBlock } from "../../../src/features/agent-message/agent-message-data.ts"
import { applyThreadStreamFrame, type StreamFrame } from "../../../src/features/agent-message/run-stream-reducer.ts"

// The thread is folded twice from the same frames: by the runner for its
// snapshots and by this reducer for the live view. Both are driven here.
function session() {
  const stream = new SessionStream({ provider: "pi", id: "session" })
  let messages: AgentThreadMessage[] = []
  const send = (event: AgentEvent, runId = "run") => {
    const frame = JSON.parse(JSON.stringify(stream.publish(event, runId))) as StreamFrame
    messages = applyThreadStreamFrame(messages, runId, frame)
  }
  return { stream, send, messages: () => messages }
}

function toolCards(blocks: readonly StreamBlock[] | undefined) {
  return (blocks ?? []).flatMap((block) => block.type === "tool_use"
    ? [{ id: block.id, blockId: block.blockId, name: block.name, status: block.tool?.status, input: block.tool?.input }] : [])
}

describe("run stream reducer", () => {
  it("shows one card for a Pi tool call whose id arrives after the call starts streaming", () => {
    const { stream, send, messages } = session()
    const mapper = new PiEventMapper({ sessionId: "session", model: "m" })
    const native = (event: Parameters<PiEventMapper["push"]>[0]) => { for (const mapped of mapper.push(event)) send(mapped) }
    send({ type: "run.started" })
    native({ type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 0 } })
    assert.deepEqual(toolCards(messages().at(-1)?.blocks).map((card) => card.name), ["unknown"])

    native({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: '{"command":',
      partial: { content: [{ type: "toolCall", id: "tc1", name: "bash" }] } } })
    native({ type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 0,
      toolCall: { id: "tc1", name: "bash", arguments: { command: "echo ping" } } } })
    native({ type: "tool_execution_start", toolCallId: "tc1", toolName: "bash", args: { command: "echo ping" } })
    native({ type: "tool_execution_end", toolCallId: "tc1", toolName: "bash", isError: false, result: { content: [{ type: "text", text: "ping\n" }] } })

    const expected = [{ id: "tc1", blockId: "tc1", name: "bash", status: "completed", input: { command: "echo ping" } }]
    assert.deepEqual(toolCards(messages().at(-1)?.blocks), expected)
    const snapshot = JSON.parse(JSON.stringify(stream.snapshot().messages)) as AgentThreadMessage[]
    assert.deepEqual(toolCards(snapshot.at(-1)?.blocks), expected)
  })

  it("claims the announced block of its own message position only", () => {
    const { send, messages } = session()
    send({ type: "run.started" })
    send({ type: "assistant.delta", messageId: "msg_1", blockId: "msg_1:0", index: 0, text: "First." })
    send({ type: "assistant.block_start", messageId: "msg_2", blockId: "msg_2:0", index: 0, kind: "tool_use" })
    send({ type: "tool.started", messageId: "msg_2", blockId: "tc2", index: 0, id: "tc2", name: "read" })
    send({ type: "tool.started", messageId: "msg_2", blockId: "tc3", index: 0, id: "tc3", name: "bash" })

    assert.deepEqual((messages().at(-1)?.blocks ?? []).map((block) => block.type === "tool_use" ? `${block.id}:${block.name}@${block.index}` : block.type),
      ["text", "tc2:read@1", "tc3:bash@2"])
  })

  it("keeps reading a partial tool input whose latest chunk happens to end with a brace", () => {
    const { send, messages } = session()
    send({ type: "run.started" })
    send({ type: "tool.started", messageId: "m", blockId: "bash-1", index: 0, id: "bash-1", name: "bash" })
    send({ type: "tool.input_delta", messageId: "m", blockId: "bash-1", index: 0, id: "bash-1", chunk: '{"command":"echo ${HOME}' })
    assert.deepEqual(toolCards(messages().at(-1)?.blocks)[0]?.input, { command: "echo ${HOME}" })
    send({ type: "tool.input_delta", messageId: "m", blockId: "bash-1", index: 0, id: "bash-1", chunk: '","timeout":5}' })
    assert.deepEqual(toolCards(messages().at(-1)?.blocks)[0]?.input, { command: "echo ${HOME}", timeout: 5 })
  })

  it("re-renders only the message that owns a background task when the task changes", () => {
    const { send, messages } = session()
    send({ type: "run.started", userMessage: { id: "user-1", role: "user", content: "Start", status: "complete", createdAt: new Date(1).toISOString() } }, "first")
    send({ type: "assistant.message", messageId: "model-1", blocks: [{ type: "tool_use", id: "tool-1", blockId: "tool-1", index: 0, name: "Agent", input: {} }] }, "first")
    send({ type: "run.completed", model: "m", durationMs: 1 }, "first")
    send({ type: "run.started", userMessage: { id: "user-2", role: "user", content: "Again", status: "complete", createdAt: new Date(2).toISOString() } }, "second")
    send({ type: "assistant.delta", messageId: "model-2", blockId: "model-2:0", index: 0, text: "Working" }, "second")
    const before = messages()

    send({ type: "task.updated", task: { taskId: "worker", toolUseId: "tool-1", kind: "agent", status: "running" } }, "second")
    const after = messages()

    assert.deepEqual(after.map((message) => message.id), before.map((message) => message.id))
    const owner = after.find((message) => message.id === "first")
    const ownerBlock = owner?.blocks?.[0]
    assert.equal(ownerBlock?.type === "tool_use" ? ownerBlock.tool?.backgroundTask?.taskId : undefined, "worker")
    for (const message of after) {
      const previous = before.find((item) => item.id === message.id)
      if (message.id === "first") assert.notEqual(message, previous)
      else assert.equal(message, previous)
    }
  })
})
