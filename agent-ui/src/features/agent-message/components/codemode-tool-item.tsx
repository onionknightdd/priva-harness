import type { ReactNode } from "react"
import { Braces, Code2, ImageIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { ToolResult, type ToolResultStatus } from "@/components/agents/tool-result"
import { Skeleton } from "@/components/ui/skeleton"

import type { ModelInvocation, StreamBlock } from "../agent-message-data"
import { isToolRunning } from "../tool-activity"
import { ImageToolPreview } from "./image-tool-preview"

type ToolBlock = Extract<StreamBlock, { type: "tool_use" }>

export function CodemodeToolItem({ block, children }: { block: ToolBlock; children?: ReactNode }) {
  const { t } = useTranslation()
  const tool = block.tool
  const input = tool?.input ?? block.input
  const code = input && typeof input === "object" && "code" in input && typeof input.code === "string" ? input.code : undefined
  const status: ToolResultStatus = isToolRunning(tool) ? "running" : tool?.launchStatus === "interrupted" ? "cancelled" : tool?.ok === false ? "error" : "success"
  const calls = tool?.modelCalls ?? []
  const modelPaths = new Set(calls.flatMap((call) => call.artifacts?.map((artifact) => artifact.path) ?? []))
  const outputImages = tool?.artifacts?.filter((artifact) => !modelPaths.has(artifact.path)) ?? []
  return (
    <ToolResult tool={null} title="Codemode" icon={<Code2 className="size-[1em]" />} status={status}
      defaultOpen collapseOnComplete={false} maxHeight={640} contentClassName="min-w-0 space-y-3" copyText={tool?.output}>
      {code ? <ToolResult tool={null} title="JavaScript" icon={<Code2 className="size-[1em]" />} status={status} defaultOpen={false} copyText={code}>
        <StructuredResult value={code} raw />
      </ToolResult> : null}
      {children}
      {calls.map((call) => <ModelCallItem key={call.id} call={call} />)}
      {outputImages.map((artifact) => <ImageToolPreview key={artifact.path} path={artifact.path} alt={t("agentMessage.generatedImage")} />)}
      {tool?.nestedCallsComplete === false ? <p className="text-xs text-muted-foreground">{t("toolCard.nestedHistoryLimited")}</p> : null}
      {tool?.structuredContent !== undefined ? <StructuredResult value={tool.structuredContent} /> : null}
      {tool?.output ? <pre role={status === "error" ? "alert" : undefined} className={`whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere] ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}>{tool.output}</pre> : null}
    </ToolResult>
  )
}

function ModelCallItem({ call }: { call: ModelInvocation }) {
  const { t } = useTranslation()
  const status: ToolResultStatus = call.status === "completed" ? "success" : call.status === "failed" ? "error" : call.status === "aborted" ? "cancelled" : "running"
  const image = call.operation === "generateImages"
  return (
    <ToolResult tool={t(image ? "toolCard.imageModel" : "toolCard.classifierModel")} title={`${call.provider}/${call.model}`}
      icon={image ? <ImageIcon className="size-[1em]" /> : <Braces className="size-[1em]" />}
      status={status} defaultOpen collapseOnComplete={false} maxHeight={560} contentClassName="min-w-0 space-y-2"
      meta={call.durationMs !== undefined ? `${(call.durationMs / 1000).toFixed(1)}s` : undefined}>
      {status === "running" ? <Skeleton className="h-5 w-2/3 motion-reduce:animate-none" role="status"><span className="sr-only">{t("toolCard.running")}</span></Skeleton> : null}
      {call.error ? <p role="alert" className="whitespace-pre-wrap break-words text-sm text-destructive [overflow-wrap:anywhere]">{call.error}</p> : null}
      {call.result !== undefined ? <StructuredResult value={call.result} /> : null}
      {call.artifacts?.map((artifact) => <ImageToolPreview key={artifact.path} path={artifact.path} alt={t("agentMessage.generatedImage")} />)}
    </ToolResult>
  )
}

export function StructuredResult({ value, raw = false }: { value: unknown; raw?: boolean }) {
  return <pre className="whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{raw && typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>
}
