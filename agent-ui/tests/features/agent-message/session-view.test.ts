import assert from "node:assert/strict"
import { test } from "node:test"

import {
  harnessSupportsTerminal,
  initialSessionViewState,
  selectSessionView,
  shouldResetSessionView,
} from "../../../src/features/agent-message/session-view.ts"

test("only harnesses with a runner terminal driver offer the terminal view", () => {
  assert.equal(harnessSupportsTerminal("claude"), true)
  assert.equal(harnessSupportsTerminal("pi"), false)
  assert.equal(harnessSupportsTerminal(null), false)
})

test("opening the terminal once keeps it mounted after switching back to chat", () => {
  const opened = selectSessionView(initialSessionViewState, "terminal")
  assert.deepEqual(opened, { view: "terminal", terminalOpened: true })
  assert.deepEqual(selectSessionView(opened, "chat"), { view: "chat", terminalOpened: true })
  assert.deepEqual(selectSessionView(initialSessionViewState, "chat"), initialSessionViewState)
})

test("the view survives a new conversation receiving its id but resets on a real switch", () => {
  const fresh = { chatKey: "1", sessionId: null }
  assert.equal(shouldResetSessionView(fresh, { chatKey: "1", sessionId: "created" }), false)
  assert.equal(shouldResetSessionView({ chatKey: "1", sessionId: "a" }, { chatKey: "1", sessionId: "a" }), false)
  assert.equal(shouldResetSessionView({ chatKey: "1", sessionId: "a" }, { chatKey: "1", sessionId: "b" }), true)
  assert.equal(shouldResetSessionView({ chatKey: "1", sessionId: "a" }, { chatKey: "1", sessionId: null }), true)
  assert.equal(shouldResetSessionView({ chatKey: "1", sessionId: "a" }, { chatKey: "2", sessionId: "a" }), true)
})
