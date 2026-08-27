import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { AgentThreadMessage } from "../../../src/features/agent-message/agent-message-data.ts"
import { freezeBelowMaskTarget, groupThreadTurns, turnStickyParts } from "../../../src/features/agent-message/thread-turns.ts"

function message(
  id: string,
  role: AgentThreadMessage["role"],
  content: string
): AgentThreadMessage {
  return {
    id,
    role,
    content,
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "complete",
  }
}

describe("groupThreadTurns", () => {
  it("starts a turn on each user message and collects following replies", () => {
    const firstUser = message("u1", "user", "one")
    const firstReply = message("a1", "assistant", "a")
    const secondUser = message("u2", "user", "two")
    const secondReply = message("a2", "assistant", "b")

    assert.deepEqual(
      groupThreadTurns([firstUser, firstReply, secondUser, secondReply]),
      [
        { id: firstUser.id, user: firstUser, replies: [firstReply] },
        { id: secondUser.id, user: secondUser, replies: [secondReply] },
      ]
    )
  })

  it("keeps a trailing user turn with no replies", () => {
    const user = message("u1", "user", "hello")

    assert.deepEqual(groupThreadTurns([user]), [
      { id: user.id, user, replies: [] },
    ])
  })

  it("groups leading assistant messages before the first user", () => {
    const reply = message("a1", "assistant", "hello")
    const user = message("u1", "user", "follow-up")

    assert.deepEqual(groupThreadTurns([reply, user]), [
      { id: reply.id, user: null, replies: [reply] },
      { id: user.id, user, replies: [] },
    ])
  })
})

describe("turnStickyParts", () => {
  it("freezes the user message and the streaming working line together", () => {
    const user = message("u1", "user", "hello")
    const working = {
      ...message("a1", "assistant", ""),
      status: "streaming" as const,
    }

    assert.deepEqual(
      turnStickyParts({ id: user.id, user, replies: [working] }),
      { user, working }
    )
  })

  it("freezes only the user message after the reply completes", () => {
    const user = message("u1", "user", "hello")
    const reply = message("a1", "assistant", "done")

    assert.deepEqual(
      turnStickyParts({ id: user.id, user, replies: [reply] }),
      { user, working: null }
    )
  })

  it("freezes a leading streaming reply when there is no user message", () => {
    const working = {
      ...message("a1", "assistant", ""),
      status: "streaming" as const,
    }

    assert.deepEqual(
      turnStickyParts({ id: working.id, user: null, replies: [working] }),
      { user: null, working }
    )
  })
})

describe("freezeBelowMaskTarget", () => {
  it("puts the fade under the frozen user message", () => {
    assert.equal(
      freezeBelowMaskTarget({ userStuck: true, workingStuck: false }),
      "user"
    )
  })

  it("moves the fade under the working line and clears the user fade", () => {
    assert.equal(
      freezeBelowMaskTarget({ userStuck: true, workingStuck: true }),
      "working"
    )
  })

  it("puts the fade under a frozen working line when there is no user bar", () => {
    assert.equal(
      freezeBelowMaskTarget({ userStuck: false, workingStuck: true }),
      "working"
    )
  })

  it("hides the fade until a bar is actually stuck", () => {
    assert.equal(
      freezeBelowMaskTarget({ userStuck: false, workingStuck: false }),
      null
    )
  })
})
