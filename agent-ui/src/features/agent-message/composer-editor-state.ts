import { Fragment, Schema, Slice, type Node as ProseMirrorNode } from "prosemirror-model"
import { baseKeymap, selectAll } from "prosemirror-commands"
import { history, undo, redo, closeHistory } from "prosemirror-history"
import { keymap } from "prosemirror-keymap"
import { EditorState, NodeSelection, TextSelection, type Command } from "prosemirror-state"

import { parseMessageSelections, serializeMessageSelections, type MessageSelection, type MessageSelectionPart } from "./message-select-action"
import { fileAnnotationLabel, type FileAnnotation, type FileAnnotationInput } from "./file-annotation"

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
    file_annotation: {
      inline: true, group: "inline", atom: true,
      attrs: { annotation: {} },
      toDOM: (node) => ["span", { "data-file-annotation": JSON.stringify(node.attrs.annotation) }, fileAnnotationLabel(node.attrs.annotation as FileAnnotation)],
    },
  },
})

export function composerDocument(draft: string) {
  const nodes: ProseMirrorNode[] = []
  for (const part of parseMessageSelections(draft)) {
    if (part.type === "selection") {
      nodes.push(composerSchema.nodes.message_selection.create(part.selection))
    } else if (part.type === "file_annotation") {
      nodes.push(composerSchema.nodes.file_annotation.create({ annotation: part.annotation }))
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
    } else if (node.type === composerSchema.nodes.file_annotation) {
      parts.push({ type: "file_annotation", annotation: node.attrs.annotation as FileAnnotation })
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

export function insertFileAnnotation(annotation: FileAnnotation, question: string): Command {
  return insertFileAnnotations([{ annotation, question }])
}

export function insertFileAnnotations(items: readonly FileAnnotationInput[]): Command {
  return (state, dispatch) => {
    if (items.length === 0) return false
    const nodes: ProseMirrorNode[] = []
    items.forEach(({ annotation, question }, index) => {
      if (index > 0) nodes.push(composerSchema.nodes.hard_break.create(), composerSchema.nodes.hard_break.create())
      nodes.push(composerSchema.nodes.file_annotation.create({ annotation }))
      if (question) {
        nodes.push(composerSchema.nodes.hard_break.create())
        question.replaceAll("\r\n", "\n").split("\n").forEach((line, index) => {
          if (index > 0) nodes.push(composerSchema.nodes.hard_break.create())
          if (line) nodes.push(composerSchema.text(line))
        })
      }
    })
    const tr = closeHistory(state.tr).replaceSelection(new Slice(Fragment.fromArray(nodes), 0, 0))
    dispatch?.(tr.setSelection(TextSelection.create(tr.doc, tr.selection.to)).scrollIntoView())
    return true
  }
}

function isComposerReference(node: ProseMirrorNode | null) {
  return node?.type === composerSchema.nodes.message_selection || node?.type === composerSchema.nodes.file_annotation
}

export function deleteComposerReference(direction: -1 | 1): Command {
  return (state, dispatch) => {
    const { selection } = state
    if (selection instanceof NodeSelection && isComposerReference(selection.node)) {
      dispatch?.(closeHistory(state.tr).deleteSelection().scrollIntoView())
      return true
    }
    if (!selection.empty) return false
    const node = direction < 0 ? selection.$from.nodeBefore : selection.$from.nodeAfter
    if (!node || !isComposerReference(node)) return false
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
        Backspace: deleteComposerReference(-1),
        Delete: deleteComposerReference(1),
        "Shift-Enter": (state, dispatch) => {
          dispatch?.(state.tr.replaceSelectionWith(composerSchema.nodes.hard_break.create()).scrollIntoView())
          return true
        },
      }),
      keymap(baseKeymap),
    ],
  })
}
