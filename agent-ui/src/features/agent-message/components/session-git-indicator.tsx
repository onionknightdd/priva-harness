import { CircleAlertIcon, GitBranchIcon, GitCommitHorizontalIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { TooltipHint } from "@/components/ui/tooltip"
import { EASE_OUT } from "@/lib/ease"
import { focusRing } from "@/lib/surfaces"
import { cn } from "@/lib/utils"
import { useProjectGitStatus, type ProjectGitStatusOptions } from "../use-project-git-status"

export function SessionGitIndicator(options: ProjectGitStatusOptions) {
  const { status, error, retry } = useProjectGitStatus(options)
  const { t } = useTranslation()
  const reducedMotion = useReducedMotion()
  const value = status?.branch ?? status?.commit
  if (!error && !value) return null

  const detached = !status?.branch
  const label = error
    ? t("agentMessage.git.retry")
    : t(detached ? "agentMessage.git.detached" : "agentMessage.git.branch", { value })
  const hint = error
    ? `${t("agentMessage.git.unavailable")}\n${error}\n${t("agentMessage.git.retry")}`
    : `${label}\n${status?.root ?? ""}`
  const Icon = error ? CircleAlertIcon : detached ? GitCommitHorizontalIcon : GitBranchIcon

  return (
    <motion.div
      key={error ? "error" : value}
      className="min-w-0 max-w-[45%]"
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reducedMotion ? 0 : 0.15, ease: EASE_OUT }}
    >
      <TooltipHint content={hint}>
        {error ? (
          <Button
            variant="ghost" size="sm"
            className="h-6 max-w-full gap-1.5 px-1 text-[13px] font-normal text-muted-foreground"
            aria-label={label}
            onClick={retry}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{t("agentMessage.git.unavailable")}</span>
          </Button>
        ) : (
          <div
            className={cn("flex h-6 min-w-0 items-center gap-1.5 rounded-sm px-1 text-[13px] text-muted-foreground", focusRing)}
            tabIndex={0}
            aria-label={label}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{value}</span>
          </div>
        )}
      </TooltipHint>
    </motion.div>
  )
}
