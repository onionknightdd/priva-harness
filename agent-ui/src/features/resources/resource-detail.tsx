import * as React from "react"
import { DownloadIcon, PencilIcon, PlayIcon, Trash2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { CodeBlock } from "@/components/agents/code-block"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/animate-ui/components/radix/tabs"
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/animate-ui/components/radix/switch"
import { OverflowMarquee } from "@/components/motion/overflow-marquee"
import { ResourceIconButton } from "./resource-icon-button"
import { ResourceCopyButton } from "./resource-copy-button"
import { SkillContent } from "./skill-content"
import { errorMessage, jsonRequest, resourceRequest, resourceUrl, type McpDetail, type ResourceDetail, type ResourceKind, type ResourceQuery, type SkillDetail } from "./resource-api"
import { McpEditor } from "./resource-forms"
import { McpStatusDot } from "./mcp-status-dot"
import { useMcpProbe, type McpProbeState } from "./use-mcp-probe"
import { ResourceEmpty, ResourceErrorState, ResourceLoading } from "./resource-shared"
import { TooltipHint } from "@/components/ui/tooltip"

const ToolTestSheet = React.lazy(async () => ({ default: (await import("./mcp-tool-test-sheet")).ToolTestSheet }))

export function ResourceDetailPane({ kind, query, detail, file, onChanged, onSkillUpdated }: {
  kind: ResourceKind; query: ResourceQuery; detail: ResourceDetail; file: string; onChanged: (id?: string) => void; onSkillUpdated?: (detail: SkillDetail) => Promise<void>
}) {
  const { t } = useTranslation()
  const [deleting, setDeleting] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const skill = "files" in detail ? detail : null
  const probe = useMcpProbe(skill ? null : detail as McpDetail, query)
  const canDelete = skill ? skill.canDelete : detail.source.writable
  const mutate = async (method: "PATCH" | "DELETE", body?: unknown) => {
    setBusy(true); setError(null)
    try {
      const updated = await resourceRequest<SkillDetail>(`${kind}/${detail.id}`, query, body === undefined ? { method } : jsonRequest(method, body))
      if (skill && method === "PATCH" && onSkillUpdated) await onSkillUpdated(updated)
      else onChanged(method === "DELETE" ? undefined : detail.id)
    } catch (reason) { setError(errorMessage(reason)) } finally { setBusy(false) }
  }
  return <>
    <div className="shrink-0 border-b px-5 py-4 sm:px-7" data-skill-header={skill ? "" : undefined} data-mcp-header={skill ? undefined : ""}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex h-6 min-w-0 items-center gap-2">
            <TooltipHint content={detail.name}><h2 className="min-w-0 truncate text-base font-semibold">{detail.name}</h2></TooltipHint>
            {!skill && <McpStatusDot probe={probe} />}
            {!detail.enabled && <Badge variant="secondary" className="h-4 shrink-0 px-1.5 py-0 text-[10px] leading-none transition-colors">{t("resources.disabled")}</Badge>}
            {!skill && !detail.source.writable && <Badge variant="outline" className="h-4 shrink-0 px-1.5 py-0 text-[10px] leading-none">{t("resources.readOnly")}</Badge>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2.5" aria-busy={busy || undefined}>
          {skill ? <>
            {/* Saving blocks duplicate actions without changing the cursor or dimming the toolbar. */}
            <Switch size="sm" className={skill.canToggle ? "disabled:cursor-auto disabled:opacity-100" : undefined} checked={detail.enabled} onCheckedChange={(enabled) => void mutate("PATCH", { enabled })} disabled={!skill.canToggle || busy} aria-label={t("resources.enabled")} />
            <TooltipHint content={t("resources.download")}><ResourceIconButton render={<a href={resourceUrl(`skills/${detail.id}/download`, query)} />} aria-label={t("resources.download")}><DownloadIcon /></ResourceIconButton></TooltipHint>
            <TooltipHint content={t("resources.delete")}><ResourceIconButton className={canDelete ? "disabled:opacity-100" : undefined} disabled={!canDelete || busy} onClick={() => setDeleting(true)} aria-label={t("resources.delete")}><Trash2Icon /></ResourceIconButton></TooltipHint>
          </> : <>
            <TooltipHint content={t("resources.edit")}><ResourceIconButton className={detail.source.writable ? "disabled:opacity-100" : undefined} disabled={!detail.source.writable || busy} onClick={() => setEditing(true)} aria-label={t("resources.edit")}><PencilIcon /></ResourceIconButton></TooltipHint>
            <TooltipHint content={t("resources.delete")}><ResourceIconButton className={canDelete ? "disabled:opacity-100" : undefined} disabled={!canDelete || busy} onClick={() => setDeleting(true)} aria-label={t("resources.delete")}><Trash2Icon /></ResourceIconButton></TooltipHint>
          </>}
        </div>
      </div>
      {skill ? <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{skill.description}</p> : <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2" data-mcp-metadata>
        <Badge variant="outline" className="h-5 px-2 text-xs leading-none">{(detail as McpDetail).transport.toUpperCase()}</Badge>
        {probe.capabilities?.serverVersion && <TooltipHint content={t("resources.serverVersion")}><Badge variant="outline" className="h-5 px-2 text-xs leading-none" aria-label={`${t("resources.serverVersion")}: ${probe.capabilities.serverVersion}`}>{probe.capabilities.serverVersion}</Badge></TooltipHint>}
        <TooltipHint content={(detail as McpDetail).target}><Badge variant="outline" className="h-5 min-w-0 max-w-full shrink px-2 text-xs leading-none"><OverflowMarquee>{(detail as McpDetail).target}</OverflowMarquee></Badge></TooltipHint>
        {(detail as McpDetail).override && <Badge variant="secondary" className="h-5 px-2 text-xs leading-none">{t("resources.inherited")}</Badge>}
      </div>}
    </div>
    {error && <ResourceErrorState message={error} />}
    {skill ? <SkillContent detail={skill} query={query} file={file} /> : <McpContent detail={detail as McpDetail} query={query} probe={probe} />}
    <AlertDialog open={deleting} onOpenChange={(open) => { if (!busy) setDeleting(open) }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("resources.deleteTitle")}</AlertDialogTitle><AlertDialogDescription>{t(skill ? "resources.deleteSkillHint" : "resources.deleteHint")}</AlertDialogDescription></AlertDialogHeader>
        <p className="break-all text-sm font-medium">{detail.name}</p>{error && <ResourceErrorState message={error} />}
        <AlertDialogFooter><Button variant="outline" disabled={busy} onClick={() => setDeleting(false)}>{t("resources.cancel")}</Button><Button variant="destructive" disabled={busy} onClick={() => void mutate("DELETE")}>{t("resources.delete")}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {!skill && <McpEditor query={query} detail={detail as McpDetail} projects={[]} open={editing} onOpenChange={setEditing} onSaved={(id) => { setEditing(false); onChanged(id) }} />}
  </>
}

function McpContent({ detail, query, probe }: { detail: McpDetail; query: ResourceQuery; probe: McpProbeState }) {
  const { t } = useTranslation()
  const [view, setView] = React.useState("tools")
  const [visited, setVisited] = React.useState(() => new Set(["tools"]))
  const { capabilities, testing, error } = probe
  const [tool, setTool] = React.useState<Record<string, unknown> | null>(null)
  const copiedContent = view === "configuration" ? JSON.stringify(detail.definition, null, 2)
    : capabilities ? JSON.stringify(capabilities[view as "tools" | "prompts" | "resources"], null, 2) : undefined
  return <>
    {error && <ResourceErrorState message={error} />}
    <Tabs value={view} onValueChange={(next) => { setView(next); setVisited((previous) => previous.has(next) ? previous : new Set([...previous, next])) }} className="@container min-h-0 flex-1 gap-0">
      <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-x-3 border-b px-5 sm:px-7 @lg:h-9 @lg:flex-nowrap" data-mcp-toolbar>
        <div className="flex h-8 min-w-0 basis-full items-center @lg:h-full @lg:basis-auto @lg:flex-1">
          <TooltipHint content={detail.source.path || detail.source.label}><p className="truncate text-xs text-muted-foreground">{detail.source.path || detail.source.label}</p></TooltipHint>
        </div>
        <div className="flex h-9 min-w-0 items-center gap-2 @lg:h-full">
          <ResourceCopyButton key={view} content={copiedContent} />
          <div className="min-w-0 overflow-x-auto">
            <TabsList className="h-6 rounded-(--mcp-tab-radius) p-0.5 [--mcp-tab-radius:var(--radius-md)] [&_[data-slot=motion-highlight]]:rounded-(--mcp-tab-radius)" aria-label={t("resources.mcpViews")}>
              {(["tools", "prompts", "resources", "configuration"] as const).map((key) => <TabsTrigger key={key} value={key} className="gap-1 rounded-(--mcp-tab-radius) px-2 py-0 text-xs leading-none">
                {t(`resources.${key}`)}{key !== "configuration" && capabilities && <span className="text-[10px] tabular-nums text-muted-foreground">{capabilities[key].length}</span>}
              </TabsTrigger>)}
            </TabsList>
          </div>
        </div>
      </div>
      {(["tools", "prompts", "resources"] as const).filter((key) => visited.has(key)).map((key) => <TabsContent key={key} forceMount value={key} className="flex min-h-0 flex-1 flex-col overflow-auto px-5 py-2 data-[state=inactive]:hidden sm:px-7" aria-busy={testing || undefined}>
        {testing && !capabilities ? <ResourceLoading /> : !capabilities ? <ResourceEmpty text={t(detail.enabled ? "resources.testFailed" : "resources.disabled")} /> : capabilities[key].length === 0 ? <ResourceEmpty text={t("resources.noCapabilities")} /> : <div className="divide-y">{capabilities[key].map((entry, index) => {
          const name = typeof entry.name === "string" ? entry.name : typeof entry.uri === "string" ? entry.uri : t("resources.untitled")
          return <div key={`${name}:${index}`} className="py-3"><div className="flex items-center justify-between gap-3"><h3 className="min-w-0 break-all text-sm font-medium">{name}</h3>{key === "tools" && <TooltipHint content={t("resources.testTool")}><ResourceIconButton aria-label={`${t("resources.testTool")}: ${name}`} onClick={() => setTool(entry)}><PlayIcon /></ResourceIconButton></TooltipHint>}</div>{typeof entry.description === "string" && <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{entry.description}</p>}{key !== "tools" && <div className="mt-2"><CodeBlock code={JSON.stringify(entry, null, 2)} language="json" showHeader={false} maxHeight={200} /></div>}</div>
        })}</div>}
      </TabsContent>)}
      {visited.has("configuration") && <TabsContent forceMount value="configuration" className="min-h-0 flex-1 space-y-4 overflow-auto p-5 data-[state=inactive]:hidden sm:px-7"><CodeBlock code={JSON.stringify(detail.definition, null, 2)} language="json" filename={t("resources.configuration")} maxHeight={500} />{detail.override && detail.effectiveDefinition && <CodeBlock code={JSON.stringify(detail.effectiveDefinition, null, 2)} language="json" filename={t("resources.effectiveConfig")} maxHeight={500} />}</TabsContent>}
    </Tabs>
    {tool && <React.Suspense fallback={<ResourceLoading />}><ToolTestSheet key={typeof tool.name === "string" ? tool.name : "tool"} tool={tool} query={query} serverId={detail.id} onClose={() => setTool(null)} /></React.Suspense>}
  </>
}
