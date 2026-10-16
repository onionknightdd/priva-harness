import assert from "node:assert/strict"
import { test } from "node:test"

import { applyStreamFrame } from "../../../src/features/agent-message/run-stream-reducer.ts"
import type { AgentThreadMessage } from "../../../src/features/agent-message/agent-message-data.ts"

const sentence = "There's an issue with the selected model (deepseek-flash). It may not exist or you may not have access to it."

test("a terminal error code does not replace the sentence already shown in the transcript", () => {
  const drafted: AgentThreadMessage = {
    id: "assistant",
    role: "assistant",
    content: sentence,
    status: "streaming",
    createdAt: "2026-10-16T00:59:07.820Z",
    blocks: [{ type: "text", blockId: "assistant:0", index: 0, text: sentence }],
  }
  const failed = applyStreamFrame(drafted, { type: "run.failed", message: "model_not_found" })
  assert.equal(failed.status, "error")
  assert.equal(failed.content, sentence)
})

test("later assistant text keeps an API error bubble abnormal", () => {
  const failed = applyStreamFrame({
    id: "assistant",
    role: "assistant",
    content: sentence,
    status: "error",
    createdAt: "2026-10-16T00:59:07.820Z",
    blocks: [{ type: "text", blockId: "assistant:0", index: 0, text: sentence }],
  }, { type: "assistant.delta", messageId: "assistant", blockId: "assistant:0", index: 0, text: " Run /model to pick a different model." })
  assert.equal(failed.status, "error")
  assert.equal(failed.content, `${sentence} Run /model to pick a different model.`)
})

test("a written terminal failure still becomes the error bubble when no sentence was transcribed", () => {
  const empty: AgentThreadMessage = {
    id: "assistant",
    role: "assistant",
    content: "",
    status: "streaming",
    createdAt: "2026-10-16T00:59:07.820Z",
    blocks: [],
  }
  const failed = applyStreamFrame(empty, { type: "run.failed", message: "Terminal did not acknowledge the message." })
  assert.equal(failed.content, "Terminal did not acknowledge the message.")
})
