"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { MessageCircleCodeIcon } from "lucide-react"
import { useReducedMotionConfig } from "motion/react"
import { useTranslation } from "react-i18next"

import { SelectionActionsPopover } from "@/components/primitives/selection-actions-popover"

import { readMessageSelection } from "../quote-selection"
import type { OnQuoteInChat } from "../selection-actions-context"

export function MessageSelectionActions({ onAction }: { onAction: OnQuoteInChat }) {
  const { t } = useTranslation()
  const reduceMotion = Boolean(useReducedMotionConfig())
  const pointerDown = useRef(false)
  const frame = useRef<number | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const [selection, setSelection] = useState<ReturnType<typeof readMessageSelection>>(null)
  const [keyboard, setKeyboard] = useState(false)
  const instant = reduceMotion || keyboard

  const syncSelection = useCallback(() => {
    if (document.querySelector('[data-slot="context-menu-content"]')) {
      setSelection(null)
      return
    }
    // Moving focus into the toolbar can clear the native range. Its captured
    // text remains available until an action or an explicit dismissal.
    if (menuRef.current?.contains(document.activeElement)) return
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSelection(readMessageSelection())
  }, [])

  useEffect(() => {
    const cancelFrame = () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
    const dismiss = () => {
      cancelFrame()
      setSelection(null)
    }
    const onPointerCancel = () => {
      pointerDown.current = false
      dismiss()
    }
    const onPointerDown = (event: PointerEvent) => {
      setKeyboard(false)
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      pointerDown.current = true
      dismiss()
    }
    const onPointerUp = (event: PointerEvent) => {
      pointerDown.current = false
      if (event.button !== 0 || (event.target instanceof Node && menuRef.current?.contains(event.target))) return
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
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("pointerup", onPointerUp, true)
    document.addEventListener("pointercancel", onPointerCancel, true)
    document.addEventListener("selectionchange", onSelectionChange)
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("scroll", dismiss, true)
    document.addEventListener("contextmenu", dismiss, true)
    window.addEventListener("resize", dismiss)
    window.addEventListener("blur", onPointerCancel)
    return () => {
      cancelFrame()
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("pointerup", onPointerUp, true)
      document.removeEventListener("pointercancel", onPointerCancel, true)
      document.removeEventListener("selectionchange", onSelectionChange)
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("scroll", dismiss, true)
      document.removeEventListener("contextmenu", dismiss, true)
      window.removeEventListener("resize", dismiss)
      window.removeEventListener("blur", onPointerCancel)
    }
  }, [syncSelection])

  const act = () => {
    if (!selection) return
    window.getSelection()?.removeAllRanges()
    onAction({ type: "selection", selection: { messageRole: selection.messageRole, selectedText: selection.selectedText } })
    setSelection(null)
  }

  return (
    <SelectionActionsPopover
      anchorRect={selection?.rect ?? null}
      instant={instant}
      menuRef={menuRef}
      kind="message"
      label={t("agentMessage.quoteMenuLabel")}
      actions={[
        { id: "quote", label: t("agentMessage.quoteSelection"), icon: <MessageCircleCodeIcon aria-hidden="true" />, onSelect: act },
      ]}
    />
  )
}
