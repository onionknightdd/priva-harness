"use client"

import { XIcon } from "lucide-react"
import { motion } from "motion/react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

import { tagBadgeStyle } from "./session-projects"

const badgeMotion = {
  type: "spring" as const,
  stiffness: 520,
  damping: 32,
}

export function TagChip({
  tag,
  color,
  removable,
  compact,
  disabled,
  reduceMotion,
  onRemove,
  onSelect,
}: {
  tag: string
  color: number
  removable?: boolean
  compact?: boolean
  disabled?: boolean
  reduceMotion: boolean
  onRemove?: () => void
  onSelect?: () => void
}) {
  const { t } = useTranslation()
  const colors = tagBadgeStyle(color)
  const small = compact || !removable

  return (
    <motion.span
      layout={!reduceMotion}
      initial={reduceMotion ? false : { opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
      transition={reduceMotion ? { duration: 0 } : badgeMotion}
    >
      <Badge
        variant="secondary"
        render={
          onSelect ? (
            <button type="button" disabled={disabled} />
          ) : undefined
        }
        className={cn(
          "border-0 px-1.5 shadow-none ring-0 focus-visible:border-0 focus-visible:ring-0",
          small
            ? "h-4 max-w-28 text-[10px]"
            : "h-5 max-w-32 text-xs",
          removable && "pr-0.5",
          onSelect && "cursor-pointer"
        )}
        style={colors}
        onClick={onSelect}
      >
        <span className="truncate">{tag}</span>
        {removable ? (
          <button
            type="button"
            className="rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/15"
            aria-label={t("sidebar.projects.removeTag", { tag })}
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation()
              onRemove?.()
            }}
          >
            <XIcon className={small ? "size-2.5" : "size-3"} />
          </button>
        ) : null}
      </Badge>
    </motion.span>
  )
}
