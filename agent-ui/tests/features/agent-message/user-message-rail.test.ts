import assert from "node:assert/strict"
import { after, describe, it } from "node:test"
import { JSDOM } from "jsdom"

import type { AgentThreadMessage } from "../../../src/features/agent-message/agent-message-data.ts"
import {
  USER_MESSAGE_RAIL_ITEM_MAX,
  USER_MESSAGE_RAIL_ITEM_MIN,
  activeUserMessageTurnId,
  userMessageRailEntries,
  userMessageRailItemSize,
  scrollUserMessageTurnIntoView,
  hasUserMessageRail,
  userMessageRailReply,
  userMessageRailVisible,
} from "../../../src/features/agent-message/user-message-rail.ts"
import { foldCommandSurfaces } from "../../../src/features/agent-message/slash-command-envelope.ts"
import { groupThreadTurns } from "../../../src/features/agent-message/thread-turns.ts"

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

function entriesFor(messages: AgentThreadMessage[]) {
  return userMessageRailEntries(groupThreadTurns(foldCommandSurfaces(messages)))
}

describe("userMessageRailEntries", () => {
  it("indexes user bubbles and keeps their turn index", () => {
    const leading = message("a0", "assistant", "earlier")
    const first = message("u1", "user", "one")
    const reply = message("a1", "assistant", "reply")
    const second = message("u2", "user", "two", { renderId: "render-2" })

    assert.deepEqual(entriesFor([leading, first, reply, second]), [
      {
        id: "u1",
        label: "one",
        replies: [reply],
        turnIndex: 1,
      },
      {
        id: "render-2",
        label: "two",
        replies: [],
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

    const entries = entriesFor(messages)
    assert.deepEqual(entries.map((entry) => entry.id), ["real"])
    assert.equal(entries[0]?.turnIndex, 4)
    assert.deepEqual(
      entriesFor(foldCommandSurfaces(messages)).map((entry) => [entry.id, entry.turnIndex]),
      entries.map((entry) => [entry.id, entry.turnIndex])
    )
  })

  it("keeps an attachment-only bubble and uses the file name as its line", () => {
    const image = message("shot", "user", "", {
      status: "error",
      attachments: [{ name: "shot.png", path: "/tmp/shot.png", mimeType: "image/png", size: 12 }],
    })
    const [entry] = entriesFor([image])
    assert.equal(entry?.label, "shot.png")
    assert.equal(userMessageRailReply(entry!.replies), "")
  })

  it("collapses the user line and keeps the assistant answer from text blocks", () => {
    const user = message("u", "user", "first line\n\nsecond")
    const assistant = message("a", "assistant", "ignored when blocks exist", {
      blocks: [
        { type: "text", text: "line one\n\nline two", index: 0, blockId: "b1" },
      ],
    })
    const [entry] = entriesFor([user, assistant])
    assert.equal(entry?.label, "first line second")
    assert.equal(userMessageRailReply(entry!.replies), "line one line two")
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

const dom = new JSDOM("<!doctype html><body></body>")
Object.assign(globalThis, { getComputedStyle: dom.window.getComputedStyle.bind(dom.window), CSS: { escape: (id: string) => id } })
after(() => dom.window.close())
function viewport(top = 100, scrollTop = 2000) {
  const node = dom.window.document.createElement("div")
  node.scrollTop = scrollTop
  Object.defineProperty(node, "offsetTop", { value: top })
  return node
}
function turn(host: HTMLElement, id: string, top: number, margin = 24) {
  const node = host.appendChild(dom.window.document.createElement("div"))
  node.dataset.userMessageTurn = id
  Object.defineProperty(node, "offsetTop", { configurable: true, value: top + host.scrollTop })
  Object.defineProperty(node, "offsetParent", { value: host })
  node.getBoundingClientRect = () => { throw new Error("must not read layout animation transform") }
  const sticky = node.appendChild(dom.window.document.createElement("div"))
  sticky.style.marginTop = `${margin}px`
  sticky.getBoundingClientRect = () => { throw new Error("must not read sticky visual position") }
  return node
}

describe("static user turn positions", () => {
  it("jumps to the natural start even when the bubble is pinned or pushed offscreen", () => {
    for (const margin of [8, 24]) {
      const host = viewport()
      turn(host, "history", -1600, margin)
      assert.equal(scrollUserMessageTurnIntoView(host, "history"), true)
      assert.equal(host.scrollTop, 400 + margin - 35)
    }
  })

  it("handles missing targets without moving or escaping its viewport", () => {
    const host = viewport()
    turn(viewport(), "other-thread", 300)
    assert.equal(scrollUserMessageTurnIntoView(host, "other-thread"), false)
    assert.equal(host.scrollTop, 2000)
  })

  it("highlights the last natural start that reached the header and stops reading below it", () => {
    const host = viewport()
    turn(host, "a", -300)
    turn(host, "b", 11)
    turn(host, "c", 400)
    const unused = turn(host, "d", 800)
    Object.defineProperty(unused, "offsetTop", { get() { throw new Error("must stop after first future turn") } })
    assert.equal(activeUserMessageTurnId(host), "b")
  })

  it("selects the first future turn and returns null before any turns mount", () => {
    const host = viewport()
    assert.equal(activeUserMessageTurnId(host), null)
    turn(host, "first", 200)
    assert.equal(activeUserMessageTurnId(host), "first")
  })
})

describe("userMessageRailVisible", () => {
  it("starts at the second user bubble", () => {
    assert.equal(userMessageRailVisible(1), false)
    assert.equal(userMessageRailVisible(2), true)
  })
})

describe("lazy preview text", () => {
  it("builds the index and visibility without reading assistant bodies", () => {
    let reads = 0
    const reply = message("a", "assistant", "")
    Object.defineProperty(reply, "content", { get() { reads++; return "one\n two" } })
    const first = message("first", "user", "hello")
    const second = message("second", "user", "again")
    const turns = groupThreadTurns([first, reply, second])
    const entries = userMessageRailEntries(turns)
    assert.equal(hasUserMessageRail([first, reply, second]), true)
    assert.equal(reads, 0)
    assert.equal(entries[0]!.replies, turns[0]!.replies)
    assert.equal(userMessageRailReply(entries[0]!.replies), "one two")
    assert.equal(reads, 1)
  })

  it("stops visibility checks after the second bubble and agrees with the filtered index", () => {
    const hidden = [
      message("exit", "user", "/exit"), message("config", "user", "/config"),
      message("clear", "user", CLEAR_ENVELOPE), message("compact", "user", COMPACT_ENVELOPE),
      message("model", "user", "", { modelChange: { model: "opus" } }),
      message("effort", "user", "", { effortChange: { effort: "high" } }),
      message("summary", "user", "[request interrupted by user]", { compact: { phase: "compacted" } }),
    ]
    const visible = [message("one", "user", "hello"), message("two", "user", "/config", {
      attachments: [{ name: "shot.png", path: "/tmp/shot.png", mimeType: "image/png", size: 12 }],
    })]
    for (let count = 0; count <= 2; count++) {
      const messages = [...hidden, ...visible.slice(0, count)]
      assert.equal(hasUserMessageRail(messages), userMessageRailVisible(entriesFor(messages).length))
    }
    const unused = message("unused", "user", "")
    Object.defineProperty(unused, "content", { get() { throw new Error("visibility should stop at two bubbles") } })
    assert.equal(hasUserMessageRail([...visible, unused]), true)
  })

  it("keeps replies within their folded turn and omits placeholder text", () => {
    const messages = [
      message("u1", "user", "first"), message("a1", "assistant", "first answer"),
      message("u2", "user", "second"), message("a2", "assistant", "No response requested."),
      message("a3", "assistant", "second answer"),
    ]
    const entries = entriesFor(messages)
    assert.deepEqual(entries.map((entry) => userMessageRailReply(entry.replies)), ["first answer", "second answer"])
  })
})
