import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import type { AgentToRendererMessage } from "@a2ui/web_core/v1_0"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { compileDashboard } from "./a2ui-client"
import { A2uiVisual } from "./a2ui/a2ui-visual"
import type { DashboardDefinition } from "./a2ui-markdown"
import { uiActionMessage } from "./ui-action"
import { useUiActionContinue } from "./ui-action-context"

const DashboardContext = createContext<{ messageId: string; definitions: ReadonlyMap<string, DashboardDefinition> } | undefined>(undefined)
export function DashboardMarkdownProvider({ messageId, definitions, children }: {
  messageId: string; definitions: ReadonlyMap<string, DashboardDefinition>; children: ReactNode
}) {
  return <DashboardContext value={{ messageId, definitions }}>{children}</DashboardContext>
}

export function MarkdownA2ui({ embed, label }: Record<string, unknown>) {
  const context = useContext(DashboardContext)
  if (!context || typeof embed !== "string") return null
  const definition = context.definitions.get(embed)
  // Raw HTML or Streamdown's repaired partial links cannot introduce an executable block.
  if (!definition) return typeof label === "string" ? label : null
  // The owning message is already keyed by the thread. Its native transcript ID
  // can arrive after a complete embed, without invalidating the user's form edits.
  return <DashboardBlock key={embed} messageId={context.messageId} embedId={embed}
    label={typeof label === "string" ? label : ""} definition={definition} />
}

export function DashboardBlock({ messageId, embedId, label, definition }: {
  messageId: string; embedId: string; label: string; definition: DashboardDefinition
}) {
  const { t } = useTranslation()
  const continueTurn = useUiActionContinue()
  const source = definition.status === "ready" ? definition.source : undefined
  const [compiled, setCompiled] = useState<{ source: string; messages?: AgentToRendererMessage[]; error?: string }>()
  const [repairing, setRepairing] = useState(false)
  const [repairError, setRepairError] = useState<string>()
  useEffect(() => {
    if (source === undefined) return
    let active = true
    void compileDashboard(source).then(
      (messages) => { if (active) setCompiled({ source, messages }) },
      (error: unknown) => { if (active) setCompiled({ source, error: error instanceof Error ? error.message : t("agentMessage.dashboardCompileFailed") }) },
    )
    return () => { active = false }
  }, [source, t])
  let error: string | undefined
  if (definition.status === "error") {
    error = definition.detail ?? t(definition.error === "missing" ? "agentMessage.dashboardMissingDefinition"
      : definition.error === "duplicate" ? "agentMessage.dashboardDuplicateId" : "agentMessage.dashboardInvalid", { embedId })
  } else if (compiled?.source === source) error = compiled?.error
  const messages = source !== undefined && compiled?.source === source ? compiled.messages : undefined
  const repair = async () => {
    if (!continueTurn || !error) return
    setRepairing(true)
    setRepairError(undefined)
    try {
      await continueTurn(uiActionMessage({ messageId, embedId }, {
        name: "repair_dashboard", surfaceId: "main", sourceComponentId: "root", timestamp: new Date().toISOString(),
        context: { error }, userMessage: t("agentMessage.dashboardRepairRequest", { embedId, error }),
      }))
    } catch (cause) { setRepairError(cause instanceof Error ? cause.message : t("agentMessage.visualActionUnavailable")) }
    finally { setRepairing(false) }
  }
  if (error) return <div data-slot="dashboard-embed" data-embed-id={embedId} role="alert" className="min-w-0 rounded-xl border border-border p-4 text-sm">
    <p className="font-medium">{label || "Agent dashboard"}</p>
    <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{error}</p>
    {continueTurn ? <Button className="mt-3" variant="outline" size="sm" disabled={repairing} aria-busy={repairing} onClick={() => void repair()}>{t("agentMessage.dashboardRepair")}</Button> : null}
    {repairError ? <p className="mt-2 text-destructive">{repairError}</p> : null}
  </div>
  if (!messages) return <div data-slot="dashboard-embed" data-embed-id={embedId} role="status" aria-label={t("agentMessage.dashboardPreparing")} className="min-w-0">
    <Skeleton className="h-40 w-full rounded-2xl motion-reduce:animate-none" />
    <span className="sr-only">{t("agentMessage.dashboardPreparing")}</span>
  </div>
  return <div data-slot="dashboard-embed" data-embed-id={embedId} aria-label={label || "Agent dashboard"} className="min-w-0">
    <A2uiVisual messages={messages} onAction={continueTurn ? (action) => continueTurn(uiActionMessage({ messageId, embedId }, action)) : undefined}
      onError={(error) => { if (source !== undefined) setCompiled({ source, error }) }} />
  </div>
}
