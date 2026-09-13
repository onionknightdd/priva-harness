import { useTranslation } from "react-i18next"

import { StatusDot } from "@/components/kibo-ui/status"
import type { McpProbeState } from "./use-mcp-probe"

const tones = { disabled: "idle", checking: "warning", online: "success", offline: "error" } as const

export function McpStatusDot({ probe }: { probe: McpProbeState }) {
  const { t } = useTranslation()
  return <StatusDot status={tones[probe.status]} label={t(`resources.serverStatus.${probe.status}`)} className="size-2.5" role="status" aria-live="polite" aria-busy={probe.testing || undefined} data-mcp-status={probe.status} />
}
