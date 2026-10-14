import * as React from "react"
import { MessageCircleCodeIcon } from "lucide-react"
import { useReducedMotionConfig } from "motion/react"
import { useTranslation } from "react-i18next"

import { SelectionActionsPopover } from "@/components/primitives/selection-actions-popover"
import type { SelectionActionsRect } from "@/lib/selection-actions-position"

import { sourceSelectionAnchor } from "./source-selection-anchor"

function readSourceSelection(surface: HTMLElement | null): SelectionActionsRect | null {
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
  return sourceSelectionAnchor(text, backwards, range)
}

export function SourceSelectionActions({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const reduceMotion = Boolean(useReducedMotionConfig())
  const surfaceRef = React.useRef<HTMLDivElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const returnFocus = React.useRef<HTMLElement | null>(null)
  const pointerDown = React.useRef(false)
  const pointerFromSource = React.useRef(false)
  const frame = React.useRef<number | null>(null)
  const [anchorRect, setAnchorRect] = React.useState<SelectionActionsRect | null>(null)
  const [keyboard, setKeyboard] = React.useState(false)

  const syncSelection = React.useCallback(() => {
    if (document.querySelector('[data-slot="context-menu-content"]')) {
      setAnchorRect(null)
      return
    }
    if (menuRef.current?.contains(document.activeElement)) return
    returnFocus.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement : surfaceRef.current
    setAnchorRect(readSourceSelection(surfaceRef.current))
  }, [])

  React.useEffect(() => {
    const cancelFrame = () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
    const dismiss = () => {
      cancelFrame()
      setAnchorRect(null)
    }
    const cancelPointer = () => {
      pointerDown.current = false
      pointerFromSource.current = false
      dismiss()
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
    const onKeyDown = (event: KeyboardEvent) => {
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
    document.addEventListener("pointercancel", cancelPointer, true)
    document.addEventListener("selectionchange", onSelectionChange)
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("scroll", dismiss, true)
    document.addEventListener("contextmenu", dismiss, true)
    window.addEventListener("resize", dismiss)
    window.addEventListener("blur", cancelPointer)
    return () => {
      cancelFrame()
      observer.disconnect()
      resizeObserver.disconnect()
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("pointerup", onPointerUp, true)
      document.removeEventListener("pointercancel", cancelPointer, true)
      document.removeEventListener("selectionchange", onSelectionChange)
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("scroll", dismiss, true)
      document.removeEventListener("contextmenu", dismiss, true)
      window.removeEventListener("resize", dismiss)
      window.removeEventListener("blur", cancelPointer)
    }
  }, [syncSelection])

  return (
    <div ref={surfaceRef} tabIndex={-1} className="min-h-full">
      {children}
      <SelectionActionsPopover
        anchorRect={anchorRect}
        instant={reduceMotion || keyboard}
        menuRef={menuRef}
        kind="file"
        label={t("filePreview.selectionMenuLabel")}
        actions={[{ id: "ask-agent", label: t("filePreview.askAgent"), icon: <MessageCircleCodeIcon aria-hidden="true" /> }]}
      />
    </div>
  )
}
