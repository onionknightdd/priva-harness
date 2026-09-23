import { CpuIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"
import { Card } from "@/components/ui/card"
import type { AgentThreadMessage } from "../agent-message-data"

export function ModelChangeCard({ change }: { change: NonNullable<AgentThreadMessage["modelChange"]> }) {
  const { t } = useTranslation()
  const reduced = useReducedMotion()
  return <motion.div data-model-change initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : 0.15 }}>
    <Card role="status" className="min-w-0 flex-row items-start gap-2 px-3 py-2 text-muted-foreground">
      <CpuIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
        {change.model ? t("agentMessage.modelChanged", { model: change.model }) : change.output || t("agentMessage.modelChanging")}
      </span>
    </Card>
  </motion.div>
}
