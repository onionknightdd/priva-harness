import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { AgentThreadMessage } from "../../../src/features/agent-message/agent-message-data.ts"
import {
  USER_MESSAGE_RAIL_ITEM_MAX,
  USER_MESSAGE_RAIL_ITEM_MIN,
  activeUserMessageTurnId,
  userMessageRailEntries,
  userMessageRailItemSize,
  userMessageRailScrollTop,
  userMessageRailVisible,
} from "../../../src/features/agent-message/user-message-rail.ts"
import { foldCommandSurfaces } from "../../../src/features/agent-message/slash-command-envelope.ts"

const CLEAR_ENVELOPE =
  "<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>"
const COMPACT_ENVELOPE =
  "<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>"

function message(
  id: string,
  role: AgentThreadMessage["role"],
  content: string,
  extra: Partial<AgentThreadMessage> = {}
): AgentThreadMessage {
  return {
    id,
    role,
    content,
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "complete",
    ...extra,
  }
}

describe("userMessageRailEntries", () => {
  it("indexes user bubbles and keeps their turn index", () => {
    const leading = message("a0", "assistant", "earlier")
    const first = message("u1", "user", "one")
    const reply = message("a1", "assistant", "reply")
    const second = message("u2", "user", "two", { renderId: "render-2" })

    assert.deepEqual(userMessageRailEntries([leading, first, reply, second]), [
      {
        id: "u1",
        label: "one",
        reply: "reply",
        turnIndex: 1,
      },
      {
        id: "render-2",
        label: "two",
        reply: "",
        turnIndex: 2,
      },
    ])
  })

  it("skips reset, compact, hidden commands, and setting changes", () => {
    const messages = [
      message("clear", "user", CLEAR_ENVELOPE),
      message("compact", "user", COMPACT_ENVELOPE),
      message("exit", "user", "/exit"),
      message("model", "user", "", { modelChange: { model: "opus" } }),
      message("effort", "user", "", { effortChange: { effort: "high" } }),
      message("real", "user", "keep me"),
    ]

    const entries = userMessageRailEntries(messages)
    assert.deepEqual(entries.map((entry) => entry.id), ["real"])
    assert.equal(entries[0]?.turnIndex, 4)
    assert.deepEqual(
      userMessageRailEntries(foldCommandSurfaces(messages)).map((entry) => [entry.id, entry.turnIndex]),
      entries.map((entry) => [entry.id, entry.turnIndex])
    )
  })

  it("keeps an attachment-only bubble and uses the file name as its line", () => {
    const image = message("shot", "user", "", {
      status: "error",
      attachments: [{ name: "shot.png", path: "/tmp/shot.png", mimeType: "image/png", size: 12 }],
    })
    const [entry] = userMessageRailEntries([image])
    assert.equal(entry?.label, "shot.png")
    assert.equal(entry?.reply, "")
  })

  it("collapses the user line and keeps the assistant answer from text blocks", () => {
    const user = message("u", "user", "first line\n\nsecond")
    const assistant = message("a", "assistant", "ignored when blocks exist", {
      blocks: [
        { type: "text", text: "line one\n\nline two", index: 0, blockId: "b1" },
      ],
    })
    const [entry] = userMessageRailEntries([user, assistant])
    assert.equal(entry?.label, "first line second")
    assert.equal(entry?.reply, "line one line two")
  })
})

describe("userMessageRailItemSize", () => {
  it("uses full ticks for short threads and compresses long ones", () => {
    assert.equal(userMessageRailItemSize(800, 0), USER_MESSAGE_RAIL_ITEM_MAX)
    assert.equal(userMessageRailItemSize(800, 4), USER_MESSAGE_RAIL_ITEM_MAX)
    assert.equal(userMessageRailItemSize(100, 10), 10)
    assert.equal(userMessageRailItemSize(100, 40), USER_MESSAGE_RAIL_ITEM_MIN)
    assert.equal(userMessageRailItemSize(0, 8), USER_MESSAGE_RAIL_ITEM_MIN)
  })
})

describe("activeUserMessageTurnId", () => {
  it("selects the last bubble that has reached the header", () => {
    assert.equal(activeUserMessageTurnId([
      { id: "a", top: 20 },
      { id: "b", top: 36 },
      { id: "c", top: 400 },
    ], 35), "b")
  })

  it("selects the first bubble still below the header", () => {
    assert.equal(activeUserMessageTurnId([
      { id: "a", top: 80 },
      { id: "b", top: 200 },
    ], 35), "a")
  })
})

describe("userMessageRailScrollTop", () => {
  it("places the bubble under the header", () => {
    assert.equal(userMessageRailScrollTop({
      viewportTop: 10,
      viewportScrollTop: 400,
      targetTop: 210,
      headerHeight: 35,
    }), 565)
  })
})

describe("userMessageRailVisible", () => {
  it("starts at the second user bubble", () => {
    assert.equal(userMessageRailVisible(1), false)
    assert.equal(userMessageRailVisible(2), true)
  })
})
