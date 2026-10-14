import * as React from "react"
import { MessageCircleCodeIcon } from "lucide-react"
import { useReducedMotionConfig } from "motion/react"
import { useTranslation } from "react-i18next"

import { SelectionActionsPopover } from "@/components/primitives/selection-actions-popover"
import type { SelectionActionsRect } from "@/lib/selection-actions-position"
import type { FileAnnotation } from "@/features/agent-message/file-annotation"
import { useOptionalWorkspaceFiles } from "@/features/workspace/workspace-files-context"

import { sourceSelectionAnchor } from "./source-selection-anchor"
import { readSourceFileAnnotation } from "./source-file-annotation"
import "./source-selection-actions.css"

const retainedHighlightName = "file-source-selection"

function readSourceSelection(surface: HTMLElement | null): { rect: SelectionActionsRect; range: Range } | null {
  if (!surface || surface.getClientRects().length === 0 ||
      surface.closest('[hidden], [inert], [aria-hidden="true"]')) return null
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0 ||
      !selection.anchorNode || !selection.focusNode ||
      !surface.contains(selection.anchorNode) || !surface.contains(selection.focusNode)) return null
  const text = selection.toString()
  if (!text.trim()) return null
  const range = selection.getRangeAt(selection.rangeCount - 1)
  const backwards = selection.focusNode === range.startContainer && selection.focusOffset === range.startOffset
  const rect = sourceSelectionAnchor(text, backwards, range)
  return rect ? { rect, range: range.cloneRange() } : null
}

export function SourceSelectionActions({ children, filePath, content }: { children: React.ReactNode; filePath: string; content: string }) {
  const { t } = useTranslation()
  const workspaceFiles = useOptionalWorkspaceFiles()
  const reduceMotion = Boolean(useReducedMotionConfig())
  const surfaceRef = React.useRef<HTMLDivElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const returnFocus = React.useRef<HTMLElement | null>(null)
  const pointerDown = React.useRef(false)
  const pointerFromSource = React.useRef(false)
  const frame = React.useRef<number | null>(null)
  const retainedRange = React.useRef<Range | null>(null)
  const retainedAnnotation = React.useRef<FileAnnotation | null>(null)
  const retainedHighlight = React.useRef<Highlight | null>(null)
  const restoredInput = React.useRef<HTMLInputElement | null>(null)
  const [anchorRect, setAnchorRect] = React.useState<SelectionActionsRect | null>(null)
  const [keyboard, setKeyboard] = React.useState(false)

  const clearRetainedSelection = React.useCallback(() => {
    if (CSS.highlights.get(retainedHighlightName) === retainedHighlight.current) {
      CSS.highlights.delete(retainedHighlightName)
    }
    retainedHighlight.current = null
    retainedRange.current = null
    retainedAnnotation.current = null
    restoredInput.current = null
  }, [])

  const syncRetainedHighlight = React.useCallback(() => {
    const range = retainedRange.current
    const surface = surfaceRef.current
    if (!range || !surface) return
    const selection = window.getSelection()
    const native = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null
    if (native && native.startContainer === range.startContainer && native.startOffset === range.startOffset &&
        native.endContainer === range.endContainer && native.endOffset === range.endOffset) {
      if (CSS.highlights.get(retainedHighlightName) === retainedHighlight.current) CSS.highlights.delete(retainedHighlightName)
      return
    }
    if (!retainedHighlight.current) {
      const ranges: Range[] = []
      // Clip to the code itself: a DOM selection can span nonselectable gutters.
      for (const code of surface.querySelectorAll<HTMLElement>("code[data-source-line]")) {
        const clipped = document.createRange()
        clipped.selectNodeContents(code)
        if (range.compareBoundaryPoints(Range.END_TO_START, clipped) >= 0 ||
            range.compareBoundaryPoints(Range.START_TO_END, clipped) <= 0) continue
        if (range.compareBoundaryPoints(Range.START_TO_START, clipped) > 0) clipped.setStart(range.startContainer, range.startOffset)
        if (range.compareBoundaryPoints(Range.END_TO_END, clipped) < 0) clipped.setEnd(range.endContainer, range.endOffset)
        if (!clipped.collapsed) ranges.push(clipped)
      }
      const code = surface.querySelector("code[data-source-line]")
      if (code) {
        const selectionStyle = getComputedStyle(code, "::selection")
        const hasBackground = selectionStyle.backgroundColor !== "rgba(0, 0, 0, 0)" && selectionStyle.backgroundColor !== "transparent"
        surface.style.setProperty("--source-selection-background", hasBackground ? selectionStyle.backgroundColor : "Highlight")
        surface.style.setProperty("--source-selection-color", hasBackground ? selectionStyle.color : "HighlightText")
      }
      retainedHighlight.current = new Highlight(...ranges)
    }
    CSS.highlights.set(retainedHighlightName, retainedHighlight.current)
  }, [])

  const restoreSourceSelection = React.useCallback(() => {
    const range = retainedRange.current
    const selection = window.getSelection()
    if (!range || !selection || !range.startContainer.isConnected || !range.endContainer.isConnected) return
    const current = selection.rangeCount === 1 ? selection.getRangeAt(0) : null
    if (current && current.startContainer === range.startContainer && current.startOffset === range.startOffset &&
        current.endContainer === range.endContainer && current.endOffset === range.endOffset) return
    selection.removeAllRanges()
    selection.addRange(range.cloneRange())
  }, [])

  const syncSelection = React.useCallback(() => {
    if (document.querySelector('[data-slot="context-menu-content"]')) {
      clearRetainedSelection()
      setAnchorRect(null)
      return
    }
    if (menuRef.current?.contains(document.activeElement)) {
      syncRetainedHighlight()
      return
    }
    returnFocus.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement : surfaceRef.current
    const selected = readSourceSelection(surfaceRef.current)
    clearRetainedSelection()
    retainedRange.current = selected?.range ?? null
    if (selected && surfaceRef.current) {
      retainedAnnotation.current = readSourceFileAnnotation(surfaceRef.current, selected.range, filePath, content)
    }
    setAnchorRect(selected?.rect ?? null)
  }, [clearRetainedSelection, content, filePath, syncRetainedHighlight])

  React.useEffect(() => {
    const cancelFrame = () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
    const dismiss = () => {
      cancelFrame()
      clearRetainedSelection()
      setAnchorRect(null)
    }
    const cancelPointer = () => {
      pointerDown.current = false
      pointerFromSource.current = false
      dismiss()
    }
    const onPointerCancel = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      cancelPointer()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      setKeyboard(false)
      pointerDown.current = true
      pointerFromSource.current = event.target instanceof Node && Boolean(surfaceRef.current?.contains(event.target))
      dismiss()
    }
    const onPointerUp = (event: PointerEvent) => {
      const fromSource = pointerFromSource.current
      pointerDown.current = false
      pointerFromSource.current = false
      if (!fromSource || event.button !== 0 ||
          (event.target instanceof Node && menuRef.current?.contains(event.target))) return
      cancelFrame()
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        syncSelection()
      })
    }
    const onSelectionChange = () => {
      if (!pointerDown.current) syncSelection()
    }
    const onFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) return
      if (event.target instanceof HTMLInputElement) {
        if (restoredInput.current === event.target) return
        restoredInput.current = event.target
      }
      // Restore on entering the control, never while the input is selecting text.
      restoreSourceSelection()
      syncRetainedHighlight()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return
      setKeyboard(true)
      const menu = menuRef.current
      if (!menu || menu.querySelector('[role="toolbar"][inert]')) return
      if (event.key === "Escape") {
        if (menu.contains(document.activeElement)) returnFocus.current?.focus()
        window.getSelection()?.removeAllRanges()
        dismiss()
      } else if (event.key === "Tab" && !event.shiftKey && !menu.contains(document.activeElement)) {
        event.preventDefault()
        menu.querySelector<HTMLButtonElement>("button")?.focus()
      }
    }
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      dismiss()
    }
    const surface = surfaceRef.current
    const observer = new MutationObserver(() => {
      if (surface?.closest('[hidden], [inert], [aria-hidden="true"]')) dismiss()
    })
    for (let node = surface?.parentElement; node; node = node.parentElement) {
      observer.observe(node, { attributes: true, attributeFilter: ["hidden", "inert", "aria-hidden"] })
    }
    const resizeObserver = new ResizeObserver(dismiss)
    if (surface) resizeObserver.observe(surface)
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("pointerup", onPointerUp, true)
    document.addEventListener("pointercancel", onPointerCancel, true)
    document.addEventListener("selectionchange", onSelectionChange)
    document.addEventListener("focusin", onFocusIn)
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("scroll", onScroll, true)
    document.addEventListener("contextmenu", dismiss, true)
    window.addEventListener("resize", dismiss)
    window.addEventListener("blur", cancelPointer)
    return () => {
      cancelFrame()
      clearRetainedSelection()
      observer.disconnect()
      resizeObserver.disconnect()
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("pointerup", onPointerUp, true)
      document.removeEventListener("pointercancel", onPointerCancel, true)
      document.removeEventListener("selectionchange", onSelectionChange)
      document.removeEventListener("focusin", onFocusIn)
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("scroll", onScroll, true)
      document.removeEventListener("contextmenu", dismiss, true)
      window.removeEventListener("resize", dismiss)
      window.removeEventListener("blur", cancelPointer)
    }
  }, [clearRetainedSelection, restoreSourceSelection, syncRetainedHighlight, syncSelection])

  return (
    <div ref={surfaceRef} tabIndex={-1} className="min-h-full">
      {children}
      <SelectionActionsPopover
        anchorRect={anchorRect}
        instant={reduceMotion || keyboard}
        menuRef={menuRef}
        kind="file"
        label={t("filePreview.selectionMenuLabel")}
        actions={[{
          id: "ask-agent",
          label: t("filePreview.askAgent"),
          icon: <MessageCircleCodeIcon aria-hidden="true" />,
          input: {
            placeholder: t("filePreview.askAgentPlaceholder"),
            confirmLabel: t("filePreview.confirmAgentQuestion"),
            onConfirm: (question) => {
              const annotation = retainedAnnotation.current
              if (!annotation || !workspaceFiles) return
              clearRetainedSelection()
              setAnchorRect(null)
              window.getSelection()?.removeAllRanges()
              workspaceFiles.insertFileAnnotation(annotation, question)
            },
          },
        }]}
      />
    </div>
  )
}
