import { motion, useReducedMotionConfig } from "motion/react"
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react"
import { BotIcon, BrainIcon, CheckIcon, CopyIcon, LoaderCircleIcon, TerminalIcon, TriangleAlertIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/assistant-ui/tabs"
import { Button } from "@/components/ui/button"
import { EASE_OUT } from "@/lib/ease"
import { writeClipboardText } from "@/lib/clipboard"
import { cn } from "@/lib/utils"
import { workflowDuration, type WorkflowAgent, type WorkflowAgentDetail } from "../workflow-data"
import { WorkflowStatusPill } from "./workflow-status"

export type LoadWorkflowAgent = (agent: WorkflowAgent, signal: AbortSignal) => Promise<WorkflowAgentDetail>

export function WorkflowAgentDetailPanel({ agent, now, loadDetail, enabled }: {
  agent: WorkflowAgent
  now: number
  enabled: boolean
  loadDetail: LoadWorkflowAgent
}) {
  const { t } = useTranslation()
  const reduce = useReducedMotionConfig()
  const [tab, setTab] = useState("process")
  const [detail, setDetail] = useState<WorkflowAgentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle")

  const scrollArea = useRef<HTMLDivElement | null>(null)
  const followProcess = useRef(true)
  const loadedIdentity = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (tab === "process" && followProcess.current && scrollArea.current) {
      scrollArea.current.scrollTop = scrollArea.current.scrollHeight
    }
  }, [detail, tab])

  const fetchDetail = useEffectEvent((signal: AbortSignal) => loadDetail(agent, signal))

  useEffect(() => {
    if (!enabled) return
    if (!agent.agentId) {
      setLoading(false)
      return
    }
    const abort = new AbortController()
    setLoading(true)
    const identity = `${agent.agentId}:${agent.attempt ?? 1}`
    if (loadedIdentity.current !== identity) setDetail(null)
    loadedIdentity.current = identity
    setError(false)
    let timer: number | undefined
    const refresh = async () => {
      try {
        const value = await fetchDetail(abort.signal)
        if (!abort.signal.aborted) { setDetail(value); setError(false) }
      } catch {
        if (!abort.signal.aborted) setError(true)
      } finally {
        if (!abort.signal.aborted) {
          setLoading(false)
          if (agent.state === "running") timer = window.setTimeout(() => { void refresh() }, 2000)
        }
      }
    }
    void refresh()
    return () => { abort.abort(); window.clearTimeout(timer) }
  }, [agent.agentId, agent.state, agent.attempt, loadDetail, retry, enabled])

  useEffect(() => {
    if (copyState === "idle") return
    const timer = window.setTimeout(() => setCopyState("idle"), 1600)
    return () => window.clearTimeout(timer)
  }, [copyState])

  const process = detail?.process.filter((entry) => entry.name?.toLowerCase() !== "structuredoutput")
  const processText = process?.map((entry) => [entry.name, entry.text, entry.output].filter(Boolean).join("\n")).join("\n\n")
  const full = tab === "process" ? processText || undefined : detail?.[tab === "result" ? "result" : "prompt"]
  const preview = tab === "process" ? agent.lastToolSummary : tab === "result" ? agent.resultPreview : agent.promptPreview
  const text = full ?? preview
  const duration = workflowDuration(agent.durationMs ?? (agent.state === "running" && agent.startedAt ? Math.max(0, now - agent.startedAt) : undefined))

  return (
    <section aria-label={t("agentMessage.workflowUI.agentDetails")} className={cn("min-w-0 text-foreground", reduce && "[&_*]:transition-none [&_*]:animate-none")}>
      <div className="px-3 py-2">
        <div className="flex items-start gap-2">
          <h4 className="flex min-w-0 items-start gap-1.5 text-sm font-medium"><BotIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 break-words">{agent.label}</span></h4>
          <WorkflowStatusPill status={agent.state} />
        </div>
        {agent.lastToolSummary ? <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{agent.lastToolSummary}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2 font-mono text-xs text-muted-foreground">
        {duration ? <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{duration}</span> : null}
        {agent.lastToolName && agent.lastToolName.toLowerCase() !== "structuredoutput" ? <span className="inline-flex items-center gap-1.5"><TerminalIcon aria-hidden="true" className="size-3" />{agent.lastToolName}</span> : null}
        {agent.model ? <span>{agent.model}</span> : null}
        {agent.tokens !== undefined ? <span>{agent.tokens.toLocaleString()} tokens</span> : null}
        {agent.toolCalls !== undefined ? <span>{t("agentMessage.workflowUI.toolCalls", { count: agent.toolCalls })}</span> : null}
        {agent.attempt !== undefined && agent.attempt > 1 ? <span>{t("agentMessage.workflowUI.attempt", { count: agent.attempt })}</span> : null}
      </div>
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="gap-0 border-t border-border">
        <div className="flex items-center justify-between gap-2 px-3 pt-1.5">
          <TabsList variant="ghost" size="sm" aria-label={t("agentMessage.workflowUI.agentDetails")}>
            <TabsTrigger value="prompt">{t("agentMessage.workflowUI.prompt")}</TabsTrigger>
            <TabsTrigger value="process">{t("agentMessage.workflowUI.process")}</TabsTrigger>
            <TabsTrigger value="result">{t("agentMessage.workflowUI.output")}</TabsTrigger>
          </TabsList>
          <Button variant="ghost" size="icon-sm" disabled={!text} className="motion-reduce:transform-none motion-reduce:transition-none" aria-label={t(copyState === "copied" ? "agentMessage.copied" : copyState === "error" ? "agentMessage.copyFailed" : "agentMessage.copy")}
            onClick={() => {
              if (text) void writeClipboardText(text).then(() => setCopyState("copied")).catch(() => setCopyState("error"))
            }}>
            <motion.span key={copyState} initial={copyState !== "idle" && !reduce ? { opacity: 0, transform: "scale(0.9)" } : false}
              animate={{ opacity: 1, transform: "scale(1)" }} transition={{ duration: reduce ? 0 : 0.16, ease: EASE_OUT }}>
              {copyState === "copied" ? <CheckIcon className="text-status-success" /> : copyState === "error" ? <TriangleAlertIcon className="text-status-error" /> : <CopyIcon />}
            </motion.span>
          </Button>
        </div>
        {copyState === "error" ? <p role="status" className="px-3 pt-1.5 text-xs text-status-error">{t("agentMessage.copyFailed")}</p> : null}
        {loading || error || (text && !full) ? (
          <div className="flex items-center gap-2 px-3 pt-1.5 text-xs text-muted-foreground" role="status">
            {loading ? <><LoaderCircleIcon aria-hidden="true" className="size-3 animate-spin-fast motion-reduce:animate-none" />{t("agentMessage.workflowUI.loading")}</> : null}
            {error ? <>{t("agentMessage.workflowUI.loadFailed")}<Button variant="ghost" size="xs" onClick={() => setRetry((value) => value + 1)}>{t("agentMessage.workflowUI.retry")}</Button></> : null}
            {!loading && !error && text && !full ? t("agentMessage.workflowUI.preview") : null}
          </div>
        ) : null}
        {["prompt", "process", "result"].map((value) => (
          <TabsContent key={value} value={value} className="min-w-0">
            <div ref={value === tab ? scrollArea : undefined} tabIndex={0}
              aria-label={t(`agentMessage.workflowUI.${value === "result" ? "output" : value}`)}
              onScroll={(event) => {
                if (value !== "process") return
                const area = event.currentTarget
                followProcess.current = area.scrollHeight - area.scrollTop - area.clientHeight < 24
              }}
              className="h-72 overflow-y-auto overscroll-contain px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50">
              {value === "process" && process?.length ? (
                <div className="space-y-2">
                  {process.map((entry) => (
                    <div key={entry.id} className={cn("min-w-0", entry.kind === "tool" && "rounded-md border border-border bg-muted/20 p-2")}>
                      {entry.kind === "thinking" ? <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><BrainIcon aria-hidden="true" className="size-3" />{t("agentMessage.workflowUI.thinking")}</div> : null}
                      {entry.name ? <div className="mb-1 flex items-center gap-1.5 text-xs font-medium"><TerminalIcon aria-hidden="true" className="size-3" />{entry.name}
                        {entry.isError ? <span className="text-status-error">{t("agentMessage.workflowUI.status.failed")}</span> : null}
                      </div> : null}
                      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground">{entry.text}</pre>
                      {entry.output !== undefined ? <pre className="mt-2 border-t border-border pt-2 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">{entry.output}</pre> : null}
                    </div>
                  ))}
                </div>
              ) : <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                {text ?? (loading ? "" : agent.error && value === "result" ? agent.error : t("agentMessage.workflowUI.noContent"))}
              </pre>}
            </div>
          </TabsContent>
        ))}
      </Tabs>

    </section>
  )
}
