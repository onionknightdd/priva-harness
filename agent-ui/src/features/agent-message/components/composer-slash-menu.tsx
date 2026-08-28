import * as React from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import type { SlashCommand, SlashKind, SlashOrigin } from "@/lib/api/slash-commands"
import { cn } from "@/lib/utils"

import {
  groupSlashCommands,
  positionSlashMenuPanel,
  slashOptionId,
  SLASH_MENU_PANEL_WIDTH_PX,
} from "../composer-slash-command"

const COMPOSER_SLASH_MENU_WIDTH_CLASS =
  "w-80 min-w-80 max-w-[min(20rem,calc(100vw-2rem))] text-sm"
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
  const [box, setBox] = React.useState<{ left: number; bottom: number } | null>(
    null
  )
  const groups = groupSlashCommands(commands)
  let itemIndex = -1

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
      setBox(
        positionSlashMenuPanel(
          rect.top,
          rect.left,
          window.innerWidth,
          window.innerHeight
        )
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

    document
      .getElementById(slashOptionId(menuId, highlightedIndex))
      ?.scrollIntoView({ block: "nearest" })
  }, [highlightedIndex, menuId, open])

  if (typeof document === "undefined") {
    return null
  }

  return createPortal(
    <AnimatePresence>
      {open && box ? (
        <motion.div
          ref={panelRef}
          id={menuId}
          role="listbox"
          aria-label={t("agentMessage.slashMenuLabel")}
          tabIndex={-1}
          initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2 }}
          style={{
            position: "fixed",
            left: box.left,
            bottom: box.bottom,
            width: SLASH_MENU_PANEL_WIDTH_PX,
            zIndex: 50,
          }}
          className={cn(
            "bg-popover text-popover-foreground max-h-72 origin-bottom overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md outline-none",
            COMPOSER_SLASH_MENU_WIDTH_CLASS
          )}
          onMouseDown={(event) => event.preventDefault()}
        >
          {groups.length === 0 ? (
            <div className="px-2 py-3 text-sm text-muted-foreground">
              {t("agentMessage.slashEmpty")}
            </div>
          ) : (
            groups.map((group, groupIndex) => (
              <React.Fragment key={group.kind}>
                {groupIndex > 0 ? (
                  <div className="bg-border -mx-1 my-1 h-px" />
                ) : null}
                <div role="group" aria-label={t(slashKindLabelKey(group.kind))}>
                  <div className={COMPOSER_SLASH_LABEL_CLASS}>
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
                        role="option"
                        aria-selected={highlighted}
                        className={cn(
                          COMPOSER_SLASH_ITEM_CLASS,
                          highlighted && "bg-accent"
                        )}
                        onMouseMove={() => onHighlight(index)}
                        onClick={() => onSelect(command)}
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <span className="shrink-0 font-mono">
                            /{command.name}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
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
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  )
}

function slashKindLabelKey(kind: SlashKind) {
  return kind === "skill"
    ? "agentMessage.slashSkillGroup"
    : "agentMessage.slashCommandGroup"
}

function slashOriginLabelKey(origin: SlashOrigin) {
  switch (origin) {
    case "user":
      return "agentMessage.slashOriginUser"
    case "project":
      return "agentMessage.slashOriginProject"
    default:
      return "agentMessage.slashOriginBuiltin"
  }
}
