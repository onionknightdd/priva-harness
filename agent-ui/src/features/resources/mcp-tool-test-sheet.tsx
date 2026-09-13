import { useMemo, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import type { RJSFSchema } from "@rjsf/utils"
import { useTranslation } from "react-i18next"

import { CodeBlock } from "@/components/agents/code-block"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { McpToolForm } from "./mcp-tool-form"
import { errorMessage, jsonRequest, resourceRequest, type ResourceQuery } from "./resource-api"
import { ResourceErrorState } from "./resource-shared"

export function ToolTestSheet({ tool, query, serverId, onClose }: { tool: Record<string, unknown>; query: ResourceQuery; serverId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const reduced = useReducedMotion()
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const schema = useMemo<RJSFSchema>(() => tool.inputSchema && typeof tool.inputSchema === "object" && !Array.isArray(tool.inputSchema) ? tool.inputSchema as RJSFSchema : { type: "object", properties: {} }, [tool.inputSchema])
  const run = async (args: Record<string, unknown>) => {
    if (running) return
    setRunning(true); setError(null); setResult(null)
    try {
      const output = await resourceRequest<unknown>("mcp/validate/tool", query, jsonRequest("POST", { id: serverId, name: tool.name, args }))
      setResult(JSON.stringify(output, null, 2))
    } catch (reason) { setError(errorMessage(reason)) } finally { setRunning(false) }
  }
  return <Sheet open onOpenChange={(open) => { if (!open) onClose() }}><SheetContent className="data-[side=right]:w-full sm:data-[side=right]:w-[min(540px,90vw)] sm:data-[side=right]:max-w-none">
    <SheetHeader><SheetTitle>{typeof tool.name === "string" ? tool.name : t("resources.testTool")}</SheetTitle><SheetDescription>{t("resources.toolHint")}</SheetDescription></SheetHeader>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 pb-5 [scrollbar-gutter:stable]">
      {typeof tool.description === "string" && <p className="text-sm text-muted-foreground">{tool.description}</p>}
      <McpToolForm schema={schema} running={running} onSubmit={(args) => void run(args)} />
      {error && <ResourceErrorState message={error} />}
      {result && <motion.div initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.16 }}><CodeBlock code={result} filename={t("resources.result")} language="json" maxHeight={500} /></motion.div>}
    </div>
  </SheetContent></Sheet>
}
