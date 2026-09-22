import * as React from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Trans } from "react-i18next"

import { menuHighlightTransition } from "@/components/motion/menu-highlight-transition"
import { Separator } from "@/components/ui/separator"
import { EASE_OUT } from "@/lib/ease"

import {
  positionSlashMenuPanel,
  slashMenuHoverMoved,
  slashOptionId,
} from "../composer-slash-command"

const COMPOSER_SUGGEST_LABEL_CLASS =
  "px-2 py-1.5 text-xs font-medium text-muted-foreground"
const COMPOSER_SUGGEST_ITEM_CLASS =
  "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none"
// Five option rows (2rem) under the group label (1.75rem), plus the list's p-1.
const SUGGEST_MENU_LIST_CLASS =
  "relative max-h-[calc(1.75rem+2rem*5+0.5rem)] overflow-x-hidden overflow-y-auto overscroll-contain p-1"

const SUGGEST_MENU_ENTER = { duration: 0.18, ease: EASE_OUT } as const
const SUGGEST_MENU_EXIT = { duration: 0.12, ease: EASE_OUT } as const

export type ComposerSuggestGroup = {
  id: string
  label: string
  items: readonly ComposerSuggestItem[]
}

export type ComposerSuggestItem = {
  id: string
  content: React.ReactNode
}

function suggestGroupId(menuId: string, groupId: string) {
  return `${menuId}-group-${groupId}`
}

function suggestRevealTargetId(
  menuId: string,
  highlightedIndex: number,
  groups: readonly ComposerSuggestGroup[]
) {
  let index = 0
  for (const group of groups) {
    if (highlightedIndex === index) {
      return suggestGroupId(menuId, group.id)
    }
    index += group.items.length
  }
  return slashOptionId(menuId, highlightedIndex)
}

export function ComposerSuggestMenu({
  open,
  menuId,
  label,
  empty,
  hintKey = "agentMessage.slashHint",
  groups,
  highlightedIndex,
  anchorRef,
  inputRef,
  onOpenChange,
  onHighlight,
  onSelect,
}: {
  open: boolean
  menuId: string
  label: string
  empty: string
  hintKey?: string
  groups: readonly ComposerSuggestGroup[]
  highlightedIndex: number
  anchorRef: React.RefObject<HTMLElement | null>
  inputRef: React.RefObject<HTMLElement | null>
  onOpenChange: (open: boolean) => void
  onHighlight: (index: number) => void
  onSelect: (index: number) => void
}) {
  const shouldReduceMotion = Boolean(useReducedMotion())
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [box, setBox] = React.useState<{
    left: number
    bottom: number
    width: number
  } | null>(null)
  const hoverOriginRef = React.useRef<{ x: number; y: number } | null>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const [highlightBounds, setHighlightBounds] = React.useState<{
    top: number
    height: number
  } | null>(null)
  let itemIndex = -1

  React.useEffect(() => {
    if (!open) {
      hoverOriginRef.current = null
      return
    }

    const onPointerMove = (event: PointerEvent) => {
      if (hoverOriginRef.current === null) {
        hoverOriginRef.current = { x: event.clientX, y: event.clientY }
      }
    }

    window.addEventListener("pointermove", onPointerMove)
    return () => window.removeEventListener("pointermove", onPointerMove)
  }, [open])

  React.useLayoutEffect(() => {
    if (!open) {
      setBox(null)
      return
    }

    const update = () => {
      const anchor = anchorRef.current
      if (!anchor) {
        return
      }
      const rect = anchor.getBoundingClientRect()
      const next = positionSlashMenuPanel(
        rect.top,
        rect.left,
        window.innerWidth,
        window.innerHeight,
        rect.width
      )
      setBox((current) =>
        current &&
        current.left === next.left &&
        current.bottom === next.bottom &&
        current.width === next.width
          ? current
          : next
      )
    }

    update()
    const observer = new ResizeObserver(update)
    if (anchorRef.current) {
      observer.observe(anchorRef.current)
    }
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
    }
  }, [anchorRef, open])

  React.useEffect(() => {
    if (!open) {
      return
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }
      if (panelRef.current?.contains(target)) {
        return
      }
      if (inputRef.current?.contains(target)) {
        return
      }
      if (anchorRef.current?.contains(target)) {
        return
      }
      onOpenChange(false)
    }

    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [anchorRef, onOpenChange, open, inputRef])

  React.useEffect(() => {
    if (!open) {
      return
    }

    const list = listRef.current
    if (!list) {
      return
    }

    if (highlightedIndex === 0) {
      list.scrollTop = 0
      return
    }

    const target = document.getElementById(
      suggestRevealTargetId(menuId, highlightedIndex, groups)
    )
    if (target) {
      scrollChildIntoList(list, target)
    }
  }, [groups, highlightedIndex, menuId, open])

  const panelMounted = open && box !== null
  React.useLayoutEffect(() => {
    if (!panelMounted) {
      setHighlightBounds(null)
      return
    }
    const option = document.getElementById(
      slashOptionId(menuId, highlightedIndex)
    )
    if (!option) {
      setHighlightBounds(null)
      return
    }
    setHighlightBounds({ top: option.offsetTop, height: option.offsetHeight })
  }, [groups, highlightedIndex, menuId, panelMounted])

  if (typeof document === "undefined") {
    return null
  }

  return createPortal(
    <AnimatePresence>
      {open && box ? (
        <motion.div
          ref={panelRef}
          initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.96, y: 4 }}
          animate={{
            opacity: 1,
            scale: 1,
            y: 0,
            transition: shouldReduceMotion ? { duration: 0 } : SUGGEST_MENU_ENTER,
          }}
          exit={
            shouldReduceMotion
              ? { opacity: 0, transition: { duration: 0 } }
              : { opacity: 0, scale: 0.96, y: 4, transition: SUGGEST_MENU_EXIT }
          }
          style={{
            position: "fixed",
            left: box.left,
            bottom: box.bottom,
            width: box.width,
            zIndex: 50,
          }}
          className="bg-popover text-popover-foreground relative origin-bottom overflow-hidden rounded-md border text-sm shadow-md outline-none"
        >
          <div className="relative">
            <div
              ref={listRef}
              id={menuId}
              role="listbox"
              aria-label={label}
              className={SUGGEST_MENU_LIST_CLASS}
              onWheel={(event) => event.stopPropagation()}
              onMouseDown={(event) => {
                if (isVerticalScrollbarClick(event)) {
                  return
                }
                event.preventDefault()
              }}
            >
              {highlightBounds ? (
                <motion.div
                  aria-hidden="true"
                  initial={false}
                  animate={highlightBounds}
                  transition={
                    shouldReduceMotion ? { duration: 0 } : menuHighlightTransition
                  }
                  className="pointer-events-none absolute inset-x-1 rounded-sm bg-accent"
                />
              ) : null}
              {groups.length === 0 ? (
                <div className="px-2 py-3 text-sm text-muted-foreground">
                  {empty}
                </div>
              ) : (
                groups.map((group, groupIndex) => (
                  <React.Fragment key={group.id}>
                    {groupIndex > 0 ? (
                      <div className="mx-2 my-1 h-px bg-border" />
                    ) : null}
                    <div
                      role="group"
                      aria-labelledby={suggestGroupId(menuId, group.id)}
                    >
                      <div
                        id={suggestGroupId(menuId, group.id)}
                        className={COMPOSER_SUGGEST_LABEL_CLASS}
                      >
                        {group.label}
                      </div>
                      {group.items.map((item) => {
                        itemIndex += 1
                        const index = itemIndex
                        const highlighted = index === highlightedIndex
                        return (
                          <div
                            key={item.id}
                            id={slashOptionId(menuId, index)}
                            role="option"
                            aria-selected={highlighted}
                            className={COMPOSER_SUGGEST_ITEM_CLASS}
                            onMouseMove={(event) => {
                              if (
                                !slashMenuHoverMoved(hoverOriginRef.current, {
                                  x: event.clientX,
                                  y: event.clientY,
                                })
                              ) {
                                return
                              }
                              onHighlight(index)
                            }}
                            onClick={() => onSelect(index)}
                          >
                            {item.content}
                          </div>
                        )
                      })}
                    </div>
                  </React.Fragment>
                ))
              )}
            </div>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 z-10 h-3 bg-gradient-to-b from-popover to-transparent"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-3 bg-gradient-to-t from-popover to-transparent"
            />
          </div>
          <Separator />
          <div className="px-3 py-2 text-xs text-muted-foreground/70">
            <Trans
              i18nKey={hintKey}
              components={{
                tab: (
                  <kbd className="rounded-sm border border-border bg-muted/50 px-1 py-px font-sans text-[0.7rem] text-muted-foreground" />
                ),
              }}
            />
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  )
}

function scrollChildIntoList(list: HTMLElement, child: HTMLElement) {
  const listRect = list.getBoundingClientRect()
  const childRect = child.getBoundingClientRect()
  if (childRect.top < listRect.top) {
    list.scrollTop -= listRect.top - childRect.top
    return
  }
  if (childRect.bottom > listRect.bottom) {
    list.scrollTop += childRect.bottom - listRect.bottom
  }
}

function isVerticalScrollbarClick(event: React.MouseEvent<HTMLElement>) {
  const node = event.currentTarget
  const gutter = node.offsetWidth - node.clientWidth
  if (gutter <= 0) {
    return false
  }

  return event.clientX >= node.getBoundingClientRect().right - gutter
}
