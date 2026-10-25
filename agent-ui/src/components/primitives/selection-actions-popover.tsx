"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type PointerEvent, type RefObject } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "motion/react"

import SelectionActions from "@/components/primitives/SelectionActions"
import { EASE_OUT } from "@/lib/ease"
import { selectionActionsPosition, type SelectionActionsRect } from "@/lib/selection-actions-position"

type Position = { left: number; top: number }

function moveMenu(menu: HTMLDivElement, position: Position): Position {
  const left = Math.max(8, Math.min(position.left, window.innerWidth - menu.offsetWidth - 8))
  const top = Math.max(8, Math.min(position.top, window.innerHeight - menu.offsetHeight - 8))
  // Independent translate preserves the existing entrance and capsule transforms.
  menu.style.translate = `${left - Number.parseFloat(menu.style.left)}px ${top - Number.parseFloat(menu.style.top)}px`
  return { left, top }
}

export function SelectionActionsPopover({ anchorRect, instant, menuRef, kind, label, actions, openInputActionId, onInputOpenChange }: {
  anchorRect: SelectionActionsRect | null
  instant: boolean
  menuRef: RefObject<HTMLDivElement | null>
  kind: "message" | "file"
  label: string
  actions: ComponentProps<typeof SelectionActions>["actions"]
  openInputActionId?: string
  onInputOpenChange?: (open: boolean) => void
}) {
  const [mounted, setMounted] = useState(false)
  const previousAnchor = useRef(anchorRect)
  const movedPosition = useRef<Position | null>(null)
  const drag = useRef<{ pointerId: number; x: number; y: number; position: Position } | null>(null)

  useEffect(() => setMounted(true), [])

  const positionMenu = useCallback(() => {
    const menu = menuRef.current
    if (!anchorRect || !menu) return
    const position = selectionActionsPosition(anchorRect, { width: menu.offsetWidth, height: menu.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight })
    menu.style.left = `${position.left}px`
    menu.style.top = `${position.top}px`
    menu.style.transformOrigin = position.placeAbove ? "center bottom" : "center top"
    if (movedPosition.current) movedPosition.current = moveMenu(menu, movedPosition.current)
    else menu.style.translate = ""
  }, [anchorRect, menuRef])

  useLayoutEffect(() => {
    if (previousAnchor.current !== anchorRect) {
      previousAnchor.current = anchorRect
      movedPosition.current = null
      drag.current = null
    }
    const menu = menuRef.current
    if (!anchorRect || !menu) return
    positionMenu()
    const observer = new ResizeObserver(positionMenu)
    observer.observe(menu)
    return () => observer.disconnect()
  }, [anchorRect, actions, label, menuRef, mounted, positionMenu])

  const startDrag = (event: PointerEvent<HTMLSpanElement>) => {
    const menu = menuRef.current
    if (!menu || !event.isPrimary || event.button !== 0 || drag.current) return
    event.preventDefault()
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      position: movedPosition.current ?? { left: Number.parseFloat(menu.style.left), top: Number.parseFloat(menu.style.top) },
    }
    menu.setPointerCapture(event.pointerId)
  }

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  if (!mounted) return null
  return createPortal(
    <AnimatePresence>
      {anchorRect ? (
        <motion.div
          key={`${kind}-selection-actions`}
          ref={menuRef}
          data-message-selection-actions={kind === "message" ? true : undefined}
          data-file-selection-actions={kind === "file" ? true : undefined}
          className="fixed z-50"
          onPointerMove={(event) => {
            const current = drag.current
            if (!current || current.pointerId !== event.pointerId) return
            movedPosition.current = moveMenu(event.currentTarget, {
              left: current.position.left + event.clientX - current.x,
              top: current.position.top + event.clientY - current.y,
            })
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={() => { drag.current = null }}
          initial={instant ? false : { opacity: 0, transform: "translateY(4px) scale(0.96)" }}
          animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
          exit={{ opacity: 0, transition: { duration: instant ? 0 : 0.1, ease: EASE_OUT } }}
          transition={{ duration: instant ? 0 : 0.16, ease: EASE_OUT }}
        >
          <SelectionActions label={label} instant={instant} actions={actions} openInputActionId={openInputActionId} onInputOpenChange={onInputOpenChange} onLayoutChange={positionMenu} onDragStart={startDrag} />
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
