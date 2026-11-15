import { useTranslation } from "react-i18next"

import { Switch } from "@/components/motion/switch"
import { TooltipHint } from "@/components/ui/tooltip"
import { AgentDashboardIcon } from "./agent-dashboard-icon"

export function DashboardPluginSwitch({ active, pending = false, onChange }: {
  active: boolean
  pending?: boolean
  onChange: (active: boolean) => void
}) {
  const { t } = useTranslation()
  const label = t(pending ? "agentMessage.dashboardPluginPending" : active ? "agentMessage.dashboardPluginOn" : "agentMessage.dashboardPluginOff")
  return <TooltipHint content={`${label}\n${t("agentMessage.dashboardPluginDetail")}`}>
    <span data-slot="dashboard-plugin-switch" className="inline-flex items-center gap-1.5 px-1" aria-busy={pending}>
      <AgentDashboardIcon />
      <Switch size="sm" checked={active} disabled={pending} onCheckedChange={onChange} ariaLabel={label} />
      {pending ? <span className="sr-only" role="status">{label}</span> : null}
    </span>
  </TooltipHint>
}
