"use client"

import { useEffect, useLayoutEffect, useState, type ComponentProps, type RefObject } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "motion/react"

import SelectionActions from "@/components/primitives/SelectionActions"
import { EASE_OUT } from "@/lib/ease"
import { selectionActionsPosition, type SelectionActionsRect } from "@/lib/selection-actions-position"

export function SelectionActionsPopover({ anchorRect, instant, menuRef, kind, label, actions }: {
  anchorRect: SelectionActionsRect | null
  instant: boolean
  menuRef: RefObject<HTMLDivElement | null>
  kind: "message" | "file"
  label: string
  actions: ComponentProps<typeof SelectionActions>["actions"]
}) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!anchorRect || !menu) return
    const position = selectionActionsPosition(anchorRect, { width: menu.offsetWidth, height: menu.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight })
    menu.style.left = `${position.left}px`
    menu.style.top = `${position.top}px`
    menu.style.transformOrigin = position.placeAbove ? "center bottom" : "center top"
  }, [anchorRect, actions, label, menuRef, mounted])

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
          initial={instant ? false : { opacity: 0, transform: "translateY(4px) scale(0.96)" }}
          animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
          exit={{ opacity: 0, transform: "translateY(2px) scale(0.98)", transition: { duration: instant ? 0 : 0.1, ease: EASE_OUT } }}
          transition={{ duration: instant ? 0 : 0.16, ease: EASE_OUT }}
        >
          <SelectionActions label={label} instant={instant} actions={actions} />
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
