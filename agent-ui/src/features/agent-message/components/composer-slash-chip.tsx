import { XIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import type { SlashCommand } from "@/lib/api/slash-commands"
import { SPRING_LAYOUT } from "@/lib/ease"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"

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
    <HoverCard>
      <HoverCardTrigger
        delay={200}
        closeDelay={150}
        render={<span />}
        className="inline-flex"
      >
        <motion.code
          initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
          transition={shouldReduceMotion ? { duration: 0 } : SPRING_LAYOUT}
          className={cn(
            "inline-flex h-7 max-w-[min(100%,16rem)] shrink-0 items-center gap-1 rounded-md px-2 font-mono text-[13px] leading-7",
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
        </motion.code>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        sideOffset={8}
        className={cn(
          "w-72 p-3",
          shouldReduceMotion &&
            "data-open:animate-none data-closed:animate-none"
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate font-mono text-sm font-medium">
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
      </HoverCardContent>
    </HoverCard>
  )
}
