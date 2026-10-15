import { useImperativeHandle, useLayoutEffect, useRef, useState, type ComponentProps, type Ref, type RefObject } from "react"
import { createPortal } from "react-dom"
import { Slice } from "prosemirror-model"
import { closeHistory } from "prosemirror-history"
import { TextSelection } from "prosemirror-state"
import { EditorView, type NodeViewConstructor } from "prosemirror-view"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"

import { isImageAttachment } from "../composer-attachments"
import { composerDocument, createComposerState, insertFileAnnotations, insertMessageSelection, serializeComposerContent } from "../composer-editor-state"
import type { FileAnnotation, FileAnnotationInput } from "../file-annotation"
import { mentionTriggerFromState, mentionTriggersEqual, type MentionTrigger } from "../composer-mention"
import type { MessageSelection, MessageSelectionPart } from "../message-select-action"
import { FileAnnotationReference } from "./file-annotation-reference"
import { MessageSelectionQuote } from "./message-selection-quote"

export type ComposerEditorHandle = {
  focus: (atEnd?: boolean) => void
  insertSelection: (selection: MessageSelection) => void
  insertFileAnnotation: (annotation: FileAnnotation, question: string) => boolean
  insertFileAnnotations: (items: readonly FileAnnotationInput[]) => boolean
  replaceRange: (from: number, to: number, text: string) => void
}

type ReferencePortal = {
  dom: HTMLElement
  part: Exclude<MessageSelectionPart, { type: "text" }>
  remove: () => void
  key: number
}

type ComposerEditorProps = Omit<ComponentProps<"div">, "onChange" | "onKeyDown" | "children" | "ref"> & {
  ref?: Ref<ComposerEditorHandle>
  inputRef: RefObject<HTMLDivElement | null>
  draft: string
  placeholder: string
  onChange: (draft: string) => void
  onImagesPaste: (images: File[]) => void
  onKeyDown: (event: KeyboardEvent, atStart: boolean) => boolean
  onMentionChange?: (trigger: MentionTrigger | null) => void
}

export function ComposerEditor({ ref, inputRef, draft, placeholder, onChange, onImagesPaste, onKeyDown, onMentionChange, className, ...props }: ComposerEditorProps) {
  const { t } = useTranslation()
  const viewRef = useRef<EditorView | null>(null)
  const latest = useRef({ draft, onChange, onImagesPaste, onKeyDown, onMentionChange })
  const serialized = useRef(draft)
  const mentionRef = useRef<MentionTrigger | null>(null)
  const [portals, setPortals] = useState<ReferencePortal[]>([])
  useLayoutEffect(() => { latest.current = { draft, onChange, onImagesPaste, onKeyDown, onMentionChange } })

  useImperativeHandle(ref, () => {
    const insertAnnotations = (items: readonly FileAnnotationInput[]) => {
      const view = viewRef.current
      if (!view) return false
      const inserted = insertFileAnnotations(items)(view.state, view.dispatch)
      if (inserted) view.focus()
      return inserted
    }
    return {
      focus(atEnd = false) {
        const view = viewRef.current
        if (!view) return
        if (atEnd) view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
        view.focus()
      },
      insertSelection(selection) {
        const view = viewRef.current
        if (!view) return
        insertMessageSelection(selection)(view.state, view.dispatch)
        view.focus()
      },
      insertFileAnnotation(annotation, question) {
        return insertAnnotations([{ annotation, question }])
      },
      insertFileAnnotations: insertAnnotations,
      replaceRange(from, to, text) {
        const view = viewRef.current
        if (!view) return
        const tr = view.state.tr.insertText(text, from, to)
        view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + text.length)).scrollIntoView())
        view.focus()
      },
    }
  }, [])

  useLayoutEffect(() => {
    if (!inputRef.current) return
    let active = true
    let nextKey = 0
    setPortals([])
    const referenceNodeView: NodeViewConstructor = (node, view, getPos) => {
      const dom = document.createElement("span")
      dom.contentEditable = "false"
      dom.className = "composer-selection-node"
      const portal: ReferencePortal = {
        dom, key: nextKey++,
        part: node.type.name === "file_annotation"
          ? { type: "file_annotation", annotation: node.attrs.annotation as FileAnnotation }
          : { type: "selection", selection: node.attrs as MessageSelection },
        remove() {
          const pos = getPos()
          if (pos === undefined) return
          view.dispatch(closeHistory(view.state.tr).delete(pos, pos + node.nodeSize).scrollIntoView())
          view.focus()
        },
      }
      setPortals((current) => [...current, portal])
      return {
        dom,
        ignoreMutation: () => true,
        stopEvent: (event) => event.target instanceof Element && Boolean(event.target.closest("button, [role='button']")),
        destroy() {
          if (active) setPortals((current) => current.filter((entry) => entry !== portal))
        },
      }
    }
    const view = new EditorView({ mount: inputRef.current }, {
      state: createComposerState(latest.current.draft),
      dispatchTransaction(tr) {
        view.updateState(view.state.apply(tr))
        view.dom.dataset.empty = String(view.state.doc.content.size === 0)
        if (tr.docChanged) {
          serialized.current = serializeComposerContent(view.state.doc.content)
          latest.current.onChange(serialized.current)
        }
        reportMention(view, mentionRef, latest.current.onMentionChange)
      },
      handleKeyDown(view, event) {
        if (view.composing || event.isComposing || event.keyCode === 229) return false
        return latest.current.onKeyDown(event, view.state.selection.empty && view.state.selection.from === 0)
      },
      // Copy, cut and paste use the same lossless plain-text protocol as send.
      clipboardTextSerializer: (slice) => serializeComposerContent(slice.content),
      clipboardTextParser: (text) => new Slice(composerDocument(text).content, 0, 0),
      handlePaste(view, event) {
        const images = Array.from(event.clipboardData?.files ?? []).filter(isImageAttachment)
        if (images.length > 0) {
          // Images belong in the attachment queue; leave the draft and selection intact.
          latest.current.onImagesPaste(images)
          return true
        }
        const text = event.clipboardData?.getData("text/plain")
        if (text === undefined) return false
        view.dispatch(view.state.tr.replaceSelection(new Slice(composerDocument(text).content, 0, 0)).scrollIntoView())
        return true
      },
      nodeViews: {
        message_selection: referenceNodeView,
        file_annotation: referenceNodeView,
      },
    })
    viewRef.current = view
    serialized.current = latest.current.draft
    view.dom.dataset.empty = String(view.state.doc.content.size === 0)
    reportMention(view, mentionRef, latest.current.onMentionChange)
    return () => {
      active = false
      viewRef.current = null
      view.destroy()
    }
  }, [inputRef])

  useLayoutEffect(() => {
    const view = viewRef.current
    if (!view || draft === serialized.current) return
    serialized.current = draft
    if (draft === "") {
      // Sending clears history too, so Undo cannot resurrect a sent prompt.
      view.updateState(createComposerState(""))
    } else {
      const doc = composerDocument(draft)
      const from = view.state.doc.content.findDiffStart(doc.content)
      if (from !== null) {
        const end = view.state.doc.content.findDiffEnd(doc.content)!
        const overlap = from - Math.min(end.a, end.b)
        const to = overlap > 0 ? end.a + overlap : end.a
        const nextTo = overlap > 0 ? end.b + overlap : end.b
        const tr = closeHistory(view.state.tr).replaceWith(from, to, doc.content.cut(from, nextTo))
        view.updateState(view.state.apply(tr))
      }
    }
    view.dom.dataset.empty = String(view.state.doc.content.size === 0)
    reportMention(view, mentionRef, latest.current.onMentionChange)
  }, [draft])

  return <>
    <div {...props} ref={inputRef} role="textbox" aria-multiline="true" aria-placeholder={placeholder}
      data-placeholder={placeholder} data-agent-composer="prompt" data-slot="input-group-control"
      className={cn("composer-editor relative cursor-text resize-none border-0 bg-transparent outline-none", className)} />
    {portals.map((portal) => createPortal(
      portal.part.type === "file_annotation"
        ? <FileAnnotationReference annotation={portal.part.annotation} onRemove={portal.remove} removeLabel={t("agentMessage.removeSelection")} />
        : <MessageSelectionQuote selection={portal.part.selection} onRemove={portal.remove} removeLabel={t("agentMessage.removeSelection")} />,
      portal.dom, String(portal.key),
    ))}
  </>
}

function reportMention(
  view: EditorView,
  mentionRef: { current: MentionTrigger | null },
  onMentionChange: ((trigger: MentionTrigger | null) => void) | undefined
) {
  const mention = mentionTriggerFromState(view.state)
  if (mentionTriggersEqual(mentionRef.current, mention)) {
    return
  }
  mentionRef.current = mention
  onMentionChange?.(mention)
}
