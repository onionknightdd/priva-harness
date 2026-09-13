import { Fragment, Schema, type Node as ProseMirrorNode } from "prosemirror-model"
import { baseKeymap, selectAll } from "prosemirror-commands"
import { history, undo, redo, closeHistory } from "prosemirror-history"
import { keymap } from "prosemirror-keymap"
import { EditorState, NodeSelection, TextSelection, type Command } from "prosemirror-state"

import { parseMessageSelections, serializeMessageSelections, type MessageSelection, type MessageSelectionPart } from "./message-select-action"

export const composerSchema = new Schema({
  nodes: {
    doc: { content: "inline*" },
    text: { group: "inline" },
    hard_break: {
      inline: true, group: "inline", selectable: false,
      parseDOM: [{ tag: "br" }], toDOM: () => ["br"],
    },
    message_selection: {
      inline: true, group: "inline", atom: true,
      attrs: { messageRole: {}, selectedText: {} },
      toDOM: (node) => ["span", { "data-message-select-action": JSON.stringify(node.attrs) }, `"${node.attrs.selectedText}"`],
    },
  },
})

export function composerDocument(draft: string) {
  const nodes: ProseMirrorNode[] = []
  for (const part of parseMessageSelections(draft)) {
    if (part.type === "selection") {
      nodes.push(composerSchema.nodes.message_selection.create(part.selection))
    } else {
      part.text.replaceAll("\r\n", "\n").split("\n").forEach((line, index) => {
        if (index > 0) nodes.push(composerSchema.nodes.hard_break.create())
        if (line) nodes.push(composerSchema.text(line))
      })
    }
  }
  return composerSchema.nodes.doc.create(null, nodes)
}

export function serializeComposerContent(content: Fragment) {
  const parts: MessageSelectionPart[] = []
  content.forEach((node) => {
    if (node.type === composerSchema.nodes.message_selection) {
      parts.push({ type: "selection", selection: node.attrs as MessageSelection })
    } else {
      parts.push({ type: "text", text: node.isText ? node.text! : "\n" })
    }
  })
  return serializeMessageSelections(parts)
}

export function insertMessageSelection(selection: MessageSelection): Command {
  return (state, dispatch) => {
    if (!selection.selectedText.trim()) return false
    const tr = closeHistory(state.tr).replaceSelectionWith(composerSchema.nodes.message_selection.create(selection))
    dispatch?.(tr.setSelection(TextSelection.create(tr.doc, tr.selection.to)).scrollIntoView())
    return true
  }
}

export function deleteMessageSelection(direction: -1 | 1): Command {
  return (state, dispatch) => {
    const { selection } = state
    if (selection instanceof NodeSelection && selection.node.type === composerSchema.nodes.message_selection) {
      dispatch?.(closeHistory(state.tr).deleteSelection().scrollIntoView())
      return true
    }
    if (!selection.empty) return false
    const node = direction < 0 ? selection.$from.nodeBefore : selection.$from.nodeAfter
    if (node?.type !== composerSchema.nodes.message_selection) return false
    const from = direction < 0 ? selection.from - node.nodeSize : selection.from
    dispatch?.(closeHistory(state.tr).delete(from, from + node.nodeSize).scrollIntoView())
    return true
  }
}

export function createComposerState(draft: string) {
  const doc = composerDocument(draft)
  return EditorState.create({
    doc,
    selection: TextSelection.atEnd(doc),
    plugins: [
      history(),
      keymap({
        "Mod-z": undo,
        "Shift-Mod-z": redo,
        "Mod-y": redo,
        "Mod-a": selectAll,
        Backspace: deleteMessageSelection(-1),
        Delete: deleteMessageSelection(1),
        "Shift-Enter": (state, dispatch) => {
          dispatch?.(state.tr.replaceSelectionWith(composerSchema.nodes.hard_break.create()).scrollIntoView())
          return true
        },
      }),
      keymap(baseKeymap),
    ],
  })
}
