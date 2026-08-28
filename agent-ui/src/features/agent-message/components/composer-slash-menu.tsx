import * as React from "react"
import { useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPanel,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "@/components/animate-ui/components/base/menu"
import type { SlashCommand, SlashKind, SlashOrigin } from "@/lib/api/slash-commands"
import { cn } from "@/lib/utils"

import { groupSlashCommands } from "../composer-slash-command"

const COMPOSER_SLASH_MENU_WIDTH_CLASS = "w-80 min-w-80 max-w-[min(20rem,calc(100vw-2rem))] text-sm"
const COMPOSER_SLASH_LABEL_CLASS =
  "px-2 py-1.5 text-xs font-medium text-muted-foreground"

export function ComposerSlashMenu({
  open,
  commands,
  highlightedIndex,
  textareaRef,
  onOpenChange,
  onHighlight,
  onSelect,
}: {
  open: boolean
  commands: readonly SlashCommand[]
  highlightedIndex: number
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  onOpenChange: (open: boolean) => void
  onHighlight: (index: number) => void
  onSelect: (command: SlashCommand) => void
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const groups = groupSlashCommands(commands)
  let itemIndex = -1

  React.useEffect(() => {
    if (!open) {
      return
    }

    const frame = requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open, textareaRef])

  return (
    <Menu
      open={open}
      modal={false}
      onOpenChange={(nextOpen, eventDetails) => {
        if (!nextOpen && eventDetails?.reason === "focus-out") {
          eventDetails.cancel()
          return
        }
        onOpenChange(nextOpen)
      }}
    >
      <MenuTrigger
        tabIndex={-1}
        nativeButton={false}
        render={
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-2 left-10 size-px overflow-hidden"
          />
        }
      />
      <MenuPanel
        side="top"
        align="start"
        sideOffset={8}
        finalFocus={textareaRef}
        transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2 }}
        className={COMPOSER_SLASH_MENU_WIDTH_CLASS}
        onMouseDown={(event) => event.preventDefault()}
      >
        {groups.length === 0 ? (
          <div className="px-2 py-3 text-sm text-muted-foreground">
            {t("agentMessage.slashEmpty")}
          </div>
        ) : (
          groups.map((group, groupIndex) => (
            <React.Fragment key={group.kind}>
              {groupIndex > 0 ? <MenuSeparator /> : null}
              <MenuGroup>
                <MenuGroupLabel className={COMPOSER_SLASH_LABEL_CLASS}>
                  {t(slashKindLabelKey(group.kind))}
                </MenuGroupLabel>
                {group.commands.map((command) => {
                  itemIndex += 1
                  const index = itemIndex
                  const highlighted = index === highlightedIndex
                  return (
                    <MenuItem
                      key={`${command.kind}:${command.name}`}
                      closeOnClick
                      className={cn(highlighted && "bg-accent")}
                      onMouseMove={() => onHighlight(index)}
                      onClick={() => onSelect(command)}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="shrink-0 font-mono">/{command.name}</span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {command.description}
                        </span>
                      </span>
                      <MenuShortcut className="tracking-normal normal-case">
                        {t(slashOriginLabelKey(command.origin))}
                      </MenuShortcut>
                    </MenuItem>
                  )
                })}
              </MenuGroup>
            </React.Fragment>
          ))
        )}
      </MenuPanel>
    </Menu>
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
