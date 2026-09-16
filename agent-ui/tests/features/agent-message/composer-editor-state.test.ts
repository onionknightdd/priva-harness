import assert from "node:assert/strict"
import { test } from "node:test"
import { undo, redo, closeHistory } from "prosemirror-history"
import { NodeSelection, TextSelection, type Command } from "prosemirror-state"

import { composerDocument, createComposerState, deleteMessageSelection, insertMessageSelection, serializeComposerContent } from "../../../src/features/agent-message/composer-editor-state.ts"
import { mentionTriggerFromState } from "../../../src/features/agent-message/composer-mention.ts"
import { formatMessageSelection, parseMessageSelections } from "../../../src/features/agent-message/message-select-action.ts"

const selection = { messageRole: "user", selectedText: "a\nb" } as const

test("references insert at the retained caret and replace only the selected range", () => {
  let state = createComposerState("before after")
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 7, 8)))
  insertMessageSelection(selection)(state, (tr) => { state = state.apply(tr) })
  assert.deepEqual(parseMessageSelections(serializeComposerContent(state.doc.content)), [
    { type: "text", text: "before " }, { type: "selection", selection }, { type: "text", text: "fter" },
  ])
  assert.equal(state.selection.from, 8)
  assert.equal(state.selection.empty, true)
})

test("Backspace deletes one whole reference, then undo and redo restore the same node", () => {
  let state = createComposerState("before ")
  const run = (command: Command) => command(state, (tr) => { state = state.apply(tr) })
  run(insertMessageSelection(selection))
  const quoted = serializeComposerContent(state.doc.content)
  assert.equal(run(deleteMessageSelection(-1)), true)
  assert.equal(serializeComposerContent(state.doc.content), "before ")
  assert.equal(run(undo), true)
  assert.equal(serializeComposerContent(state.doc.content), quoted)
  assert.equal(run(redo), true)
  assert.equal(serializeComposerContent(state.doc.content), "before ")
  assert.equal(run(deleteMessageSelection(-1)), false)
})

test("Delete before a quote and Backspace on a node selection delete atomically", () => {
  for (const nodeSelected of [false, true]) {
    let state = createComposerState(formatMessageSelection(selection))
    state = state.apply(state.tr.setSelection(nodeSelected ? NodeSelection.create(state.doc, 0) : TextSelection.create(state.doc, 0)))
    assert.equal(deleteMessageSelection(nodeSelected ? -1 : 1)(state, (tr) => { state = state.apply(tr) }), true)
    assert.equal(state.doc.content.size, 0)
  }
})

test("typing, quote insertion and quote deletion have separate undo boundaries", () => {
  let state = createComposerState("")
  const run = (command: Command) => command(state, (tr) => { state = state.apply(tr) })
  state = state.apply(state.tr.insertText("typed"))
  run(insertMessageSelection(selection))
  run(undo)
  assert.equal(serializeComposerContent(state.doc.content), "typed")
  run(redo)
  state = state.apply(closeHistory(state.tr).insertText(" after"))
  run(undo)
  assert.equal(state.doc.lastChild?.type.name, "message_selection")
})

test("newlines and adjacent references retain order through copy/paste document conversion", () => {
  const input = `first\nsecond\n\n${formatMessageSelection(selection)}\n\n after`
  const doc = composerDocument(input)
  assert.equal(serializeComposerContent(doc.content), input)
  assert.ok(doc.eq(composerDocument(serializeComposerContent(doc.content))))
})

test("the @ mention token includes text after the caret and ignores emails", () => {
  const state = createComposerState("see @src/index.ts please")
  const caret = "see @src/in".length
  const atFile = state.apply(state.tr.setSelection(TextSelection.create(state.doc, caret)))
  assert.deepEqual(mentionTriggerFromState(atFile), {
    from: "see ".length,
    to: "see @src/index.ts".length,
    query: "src/index.ts",
    directory: "src",
    filter: "index.ts",
  })
  assert.equal(mentionTriggerFromState(createComposerState("user@host")), null)
})
