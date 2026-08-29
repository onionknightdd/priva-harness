import * as React from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Trans, useTranslation } from "react-i18next"

import type { SlashCommand } from "@/lib/api/slash-commands"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

import {
  groupSlashCommands,
  positionSlashMenuPanel,
  slashGroupId,
  slashKindLabelKey,
  slashMenuHoverMoved,
  slashOptionId,
  slashOriginLabelKey,
  slashRevealTargetId,
} from "../composer-slash-command"

const COMPOSER_SLASH_LABEL_CLASS =
  "px-2 py-1.5 text-xs font-medium text-muted-foreground"
const COMPOSER_SLASH_ITEM_CLASS =
  "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none"

export function ComposerSlashMenu({
  open,
  menuId,
  commands,
  highlightedIndex,
  anchorRef,
  textareaRef,
  onOpenChange,
  onHighlight,
  onSelect,
}: {
  open: boolean
  menuId: string
  commands: readonly SlashCommand[]
  highlightedIndex: number
  anchorRef: React.RefObject<HTMLElement | null>
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  onOpenChange: (open: boolean) => void
  onHighlight: (index: number) => void
  onSelect: (command: SlashCommand) => void
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [box, setBox] = React.useState<{
    left: number
    bottom: number
    width: number
  } | null>(null)
  const groups = React.useMemo(
    () => groupSlashCommands(commands),
    [commands]
  )
  const hoverOriginRef = React.useRef<{ x: number; y: number } | null>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
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
      if (textareaRef.current?.contains(target)) {
        return
      }
      if (anchorRef.current?.contains(target)) {
        return
      }
      onOpenChange(false)
    }

    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [anchorRef, onOpenChange, open, textareaRef])

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
      slashRevealTargetId(menuId, highlightedIndex, groups)
    )
    if (target) {
      scrollChildIntoList(list, target)
    }
  }, [groups, highlightedIndex, menuId, open])

  if (typeof document === "undefined") {
    return null
  }

  return createPortal(
    <AnimatePresence>
      {open && box ? (
        <motion.div
          ref={panelRef}
          id={menuId}
          aria-hidden="true"
          initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2 }}
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
              className="max-h-72 overflow-x-hidden overflow-y-auto overscroll-contain p-1"
              onWheel={(event) => event.stopPropagation()}
              onMouseDown={(event) => {
                if (isVerticalScrollbarClick(event)) {
                  return
                }
                event.preventDefault()
              }}
            >
              {groups.length === 0 ? (
                <div className="px-2 py-3 text-sm text-muted-foreground">
                  {t("agentMessage.slashEmpty")}
                </div>
              ) : (
                groups.map((group, groupIndex) => (
                  <React.Fragment key={group.kind}>
                    {groupIndex > 0 ? (
                      <div className="mx-2 my-1 h-px bg-border" />
                    ) : null}
                    <div>
                      <div
                        id={slashGroupId(menuId, group.kind)}
                        className={COMPOSER_SLASH_LABEL_CLASS}
                      >
                        {t(slashKindLabelKey(group.kind))}
                      </div>
                      {group.commands.map((command) => {
                        itemIndex += 1
                        const index = itemIndex
                        const highlighted = index === highlightedIndex
                        return (
                          <div
                            key={`${command.kind}:${command.name}`}
                            id={slashOptionId(menuId, index)}
                            className={cn(
                              COMPOSER_SLASH_ITEM_CLASS,
                              highlighted && "bg-accent"
                            )}
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
                            onClick={() => onSelect(command)}
                          >
                            <span className="flex min-w-0 flex-1 items-center gap-2">
                              <span className="shrink-0">
                                {command.name}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground/70">
                                {command.description}
                              </span>
                            </span>
                            <span className="text-muted-foreground ml-auto text-xs tracking-normal normal-case">
                              {t(slashOriginLabelKey(command.origin))}
                            </span>
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
              i18nKey="agentMessage.slashHint"
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
