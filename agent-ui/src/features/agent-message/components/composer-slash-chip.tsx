import { XIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import type { SlashCommand } from "@/lib/api/slash-commands"
import { SPRING_LAYOUT } from "@/lib/ease"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import { slashKindLabelKey, slashOriginLabelKey } from "../composer-slash-command"

export function ComposerSlashChip({
  command,
  onRemove,
}: {
  command: SlashCommand
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())

  return (
    <Tooltip>
      <TooltipTrigger
        closeDelay={150}
        render={<span />}
        className="inline-flex"
      >
        <motion.span
          initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
          transition={shouldReduceMotion ? { duration: 0 } : SPRING_LAYOUT}
          className={cn(
            "inline-flex h-6 max-w-[min(100%,16rem)] shrink-0 items-center gap-1 rounded-md px-2 text-sm leading-6",
            "bg-sky-500/15 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200"
          )}
        >
          <span className="min-w-0 truncate">/{command.name}</span>
          <button
            type="button"
            className="rounded-sm p-0.5 text-current/70 transition-colors hover:bg-sky-500/20 hover:text-current"
            aria-label={t("agentMessage.removeSlashCommand", {
              name: command.name,
            })}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onRemove}
          >
            <XIcon className="size-3" />
          </button>
        </motion.span>
      </TooltipTrigger>
      <TooltipContent
        hideArrow
        side="top"
        align="start"
        sideOffset={8}
        className={cn(
          "block w-72 rounded-lg bg-popover p-3 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10",
          shouldReduceMotion &&
            "data-open:animate-none data-closed:animate-none"
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium">
            /{command.name}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <Badge variant="secondary">
              {t(slashKindLabelKey(command.kind))}
            </Badge>
            <Badge variant="outline">
              {t(slashOriginLabelKey(command.origin))}
            </Badge>
          </div>
        </div>
        {command.description.trim() === "" ? null : (
          <p className="mt-2 text-sm text-muted-foreground">
            {command.description}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
