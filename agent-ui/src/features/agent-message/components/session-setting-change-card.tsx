import type { ReactNode } from "react"
import { BrainIcon, CpuIcon, type LucideIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"
import { Card } from "@/components/ui/card"
import type { AgentThreadMessage } from "../agent-message-data"

export function ModelChangeCard({ change }: { change: NonNullable<AgentThreadMessage["modelChange"]> }) {
  const { t } = useTranslation()
  return <SettingChangeCard kind="model" icon={CpuIcon}>
    {change.model ? t("agentMessage.modelChanged", { model: change.model }) : change.output || t("agentMessage.modelChanging")}
  </SettingChangeCard>
}

export function EffortChangeCard({ change }: { change: NonNullable<AgentThreadMessage["effortChange"]> }) {
  const { t } = useTranslation()
  return <SettingChangeCard kind="effort" icon={BrainIcon}>
    {change.effort ? t("agentMessage.effortChanged", { effort: change.effort })
      : change.output === undefined ? t("agentMessage.effortChanging")
      : change.output || t("agentMessage.effortCommandFinished")}
  </SettingChangeCard>
}

function SettingChangeCard({ kind, icon: Icon, children }: { kind: "model" | "effort"; icon: LucideIcon; children: ReactNode }) {
  const reduced = useReducedMotion()
  return <motion.div data-model-change={kind === "model" || undefined} data-effort-change={kind === "effort" || undefined}
    initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : 0.15 }}>
    <Card role="status" className="min-w-0 flex-row items-start gap-2 px-3 py-2 text-muted-foreground">
      <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
        {children}
      </span>
    </Card>
  </motion.div>
}
