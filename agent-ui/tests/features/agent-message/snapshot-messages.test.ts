import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { AgentThreadMessage } from "../../../src/features/agent-message/agent-message-data.ts"
import { mergeSnapshotMessages } from "../../../src/features/agent-message/run-stream-reducer.ts"

function message(
  id: string,
  content: string,
  status: AgentThreadMessage["status"] = "complete"
): AgentThreadMessage {
  return {
    id,
    role: "assistant",
    content,
    createdAt: "2026-01-01T00:00:00.000Z",
    status,
    blocks: [{ type: "text", text: content }],
  } as AgentThreadMessage
}

describe("mergeSnapshotMessages", () => {
  it("keeps the current object for messages the snapshot reproduces exactly", () => {
    const current = [message("a", "one"), message("b", "two")]
    const snapshot = [message("a", "one"), message("b", "two")]

    const merged = mergeSnapshotMessages(current, snapshot)

    assert.equal(merged[0], current[0])
    assert.equal(merged[1], current[1])
  })

  it("takes the snapshot object when any field differs", () => {
    const current = [message("a", "one"), message("b", "two", "streaming")]
    const snapshot = [message("a", "one changed"), message("b", "two")]

    const merged = mergeSnapshotMessages(current, snapshot)

    assert.equal(merged[0], snapshot[0])
    assert.equal(merged[1], snapshot[1])
  })

  it("follows the snapshot order and membership", () => {
    const current = [message("a", "one"), message("gone", "x")]
    const snapshot = [message("new", "n"), message("a", "one")]

    const merged = mergeSnapshotMessages(current, snapshot)

    assert.deepEqual(merged.map((item) => item.id), ["new", "a"])
    assert.equal(merged[1], current[0])
  })
})
