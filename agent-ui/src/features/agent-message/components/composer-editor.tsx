import { useImperativeHandle, useLayoutEffect, useRef, useState, type ComponentProps, type Ref, type RefObject } from "react"
import { createPortal } from "react-dom"
import { Slice } from "prosemirror-model"
import { closeHistory } from "prosemirror-history"
import { TextSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"

import { composerDocument, createComposerState, insertMessageSelection, serializeComposerContent } from "../composer-editor-state"
import type { MessageSelection } from "../message-select-action"
import { MessageSelectionQuote } from "./message-selection-quote"

export type ComposerEditorHandle = {
  focus: (atEnd?: boolean) => void
  insertSelection: (selection: MessageSelection) => void
}

type QuotePortal = {
  dom: HTMLElement
  selection: MessageSelection
  remove: () => void
  key: number
}

type ComposerEditorProps = Omit<ComponentProps<"div">, "onChange" | "onKeyDown" | "children" | "ref"> & {
  ref?: Ref<ComposerEditorHandle>
  inputRef: RefObject<HTMLDivElement | null>
  draft: string
  placeholder: string
  onChange: (draft: string) => void
  onKeyDown: (event: KeyboardEvent, atStart: boolean) => boolean
}

export function ComposerEditor({ ref, inputRef, draft, placeholder, onChange, onKeyDown, className, ...props }: ComposerEditorProps) {
  const { t } = useTranslation()
  const viewRef = useRef<EditorView | null>(null)
  const latest = useRef({ draft, onChange, onKeyDown })
  const serialized = useRef(draft)
  const [portals, setPortals] = useState<QuotePortal[]>([])
  useLayoutEffect(() => { latest.current = { draft, onChange, onKeyDown } })

  useImperativeHandle(ref, () => ({
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
  }), [])

  useLayoutEffect(() => {
    if (!inputRef.current) return
    let active = true
    let nextKey = 0
    setPortals([])
    const view = new EditorView({ mount: inputRef.current }, {
      state: createComposerState(latest.current.draft),
      dispatchTransaction(tr) {
        view.updateState(view.state.apply(tr))
        view.dom.dataset.empty = String(view.state.doc.content.size === 0)
        if (tr.docChanged) {
          serialized.current = serializeComposerContent(view.state.doc.content)
          latest.current.onChange(serialized.current)
        }
      },
      handleKeyDown(view, event) {
        if (view.composing || event.isComposing || event.keyCode === 229) return false
        return latest.current.onKeyDown(event, view.state.selection.empty && view.state.selection.from === 0)
      },
      // Copy, cut and paste use the same lossless plain-text protocol as send.
      clipboardTextSerializer: (slice) => serializeComposerContent(slice.content),
      clipboardTextParser: (text) => new Slice(composerDocument(text).content, 0, 0),
      handlePaste(view, event) {
        const text = event.clipboardData?.getData("text/plain")
        if (text === undefined) return false
        view.dispatch(view.state.tr.replaceSelection(new Slice(composerDocument(text).content, 0, 0)).scrollIntoView())
        return true
      },
      nodeViews: {
        message_selection(node, view, getPos) {
          const dom = document.createElement("span")
          dom.contentEditable = "false"
          dom.className = "composer-selection-node"
          const portal: QuotePortal = {
            dom, key: nextKey++, selection: node.attrs as MessageSelection,
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
            stopEvent: (event) => event.target instanceof Element && Boolean(event.target.closest("button")),
            destroy() {
              if (active) setPortals((current) => current.filter((entry) => entry !== portal))
            },
          }
        },
      },
    })
    viewRef.current = view
    serialized.current = latest.current.draft
    view.dom.dataset.empty = String(view.state.doc.content.size === 0)
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
  }, [draft])

  return <>
    <div {...props} ref={inputRef} role="textbox" aria-multiline="true" aria-placeholder={placeholder}
      data-placeholder={placeholder} data-agent-composer="prompt" data-slot="input-group-control"
      className={cn("composer-editor relative cursor-text resize-none border-0 bg-transparent outline-none", className)} />
    {portals.map((portal) => createPortal(
      <MessageSelectionQuote selection={portal.selection} onRemove={portal.remove} removeLabel={t("agentMessage.removeSelection")} />,
      portal.dom, String(portal.key),
    ))}
  </>
}
