import { workflowStatusColor } from "../workflow-data"
import { useEffect, useRef } from "react"
import { CheckCircle2Icon, CircleDashedIcon, CirclePauseIcon, CircleXIcon, LoaderCircleIcon } from "lucide-react"
import { motion, useReducedMotionConfig } from "motion/react"
import { useTranslation } from "react-i18next"
import { EASE_OUT } from "@/lib/ease"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { WorkflowStatus } from "../workflow-data"

export function WorkflowStatusMark({ status, dot = false, compact = false }: { status: WorkflowStatus; dot?: boolean; compact?: boolean }) {
  const { t } = useTranslation()
  const reduce = useReducedMotionConfig()
  const previous = useRef(status)
  const changed = previous.current !== status
  useEffect(() => { previous.current = status }, [status])
  const Icon = status === "running" ? LoaderCircleIcon
    : status === "completed" ? CheckCircle2Icon
    : status === "failed" || status === "cancelled" ? CircleXIcon
    : status === "paused" ? CirclePauseIcon : CircleDashedIcon
  return (
    <span role="img" aria-label={t(`agentMessage.workflowUI.status.${status}`)} className={cn("inline-flex shrink-0", workflowStatusColor[status])}>
      <motion.span
        key={status}
        initial={changed && !reduce ? { opacity: 0, transform: "scale(0.9)" } : false}
        animate={{ opacity: 1, transform: "scale(1)" }}
        transition={{ duration: reduce ? 0 : 0.16, ease: EASE_OUT }}
        className={cn("grid place-items-center", compact ? "size-3" : "size-4")}
      >
        {dot && status !== "running" ? <span className={cn("rounded-full bg-current", compact ? "size-1" : "size-1.5")} /> : (
          <Icon aria-hidden="true" className={cn(compact ? "size-3" : "size-3.5", status === "running" && !reduce && "animate-spin-fast motion-reduce:animate-none")} />
        )}
      </motion.span>
    </span>
  )
}

export function WorkflowStatusPill({ status }: { status: WorkflowStatus }) {
  const { t } = useTranslation()
  return (
    <Badge variant="secondary" className={cn("h-4 shrink-0 px-1.5 py-0 text-[0.65rem] leading-3 font-semibold", workflowStatusColor[status])}>
      {/* Optical alignment for the small Inter label and status glyph. */}
      <span className="inline-flex translate-y-px items-center gap-0.5">
        <WorkflowStatusMark status={status} dot compact />
        <span className="block leading-3">{t(`agentMessage.workflowUI.status.${status}`)}</span>
      </span>
    </Badge>
  )
}
