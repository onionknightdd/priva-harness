import { XIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { SPRING_LAYOUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

export function ComposerSlashChip({
  name,
  onRemove,
}: {
  name: string
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())

  return (
    <motion.code
      initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
      transition={shouldReduceMotion ? { duration: 0 } : SPRING_LAYOUT}
      className={cn(
        "inline-flex h-8 max-w-[min(100%,16rem)] shrink-0 items-center gap-1 rounded-md px-2 font-mono text-[13px] leading-8",
        "bg-sky-500/15 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200"
      )}
    >
      <span className="min-w-0 truncate">/{name}</span>
      <button
        type="button"
        className="rounded-sm p-0.5 text-current/70 transition-colors hover:bg-sky-500/20 hover:text-current"
        aria-label={t("agentMessage.removeSlashCommand", { name })}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onRemove}
      >
        <XIcon className="size-3" />
      </button>
    </motion.code>
  )
}
