import * as React from "react"
import { CableIcon, DownloadIcon, PencilIcon, PlayIcon, Trash2Icon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { CodeBlock } from "@/components/agents/code-block"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/assistant-ui/tabs"
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/animate-ui/components/radix/switch"
import { Textarea } from "@/components/ui/textarea"
import { ResourceIconButton } from "./resource-icon-button"
import { SkillContent } from "./skill-content"
import { errorMessage, jsonRequest, resourceRequest, resourceUrl, type McpCapabilities, type McpDetail, type ResourceDetail, type ResourceKind, type ResourceQuery, type SkillDetail } from "./resource-api"
import { McpEditor } from "./resource-forms"
import { ResourceEmpty, ResourceErrorState, ResourceLoading } from "./resource-shared"
import { TooltipHint } from "@/components/ui/tooltip"

export function ResourceDetailPane({ kind, query, detail, file, onChanged, onSkillUpdated }: {
  kind: ResourceKind; query: ResourceQuery; detail: ResourceDetail; file: string; onChanged: (id?: string) => void; onSkillUpdated?: (detail: SkillDetail) => Promise<void>
}) {
  const { t } = useTranslation()
  const [deleting, setDeleting] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const skill = "files" in detail ? detail : null
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
    <div className="border-b px-5 py-4 sm:px-7" data-skill-header={skill ? "" : undefined}>
      <div className={skill ? "flex items-center gap-3" : "flex flex-wrap items-center gap-3"}>
        {!skill && <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-muted/40 text-muted-foreground"><CableIcon className="size-5" /></div>}
        <div className="min-w-0 flex-1">
          <div className="flex h-6 min-w-0 items-center gap-2">
            <TooltipHint content={detail.name}><h2 className="min-w-0 truncate text-base font-semibold">{detail.name}</h2></TooltipHint>
            {skill && !detail.enabled && <Badge variant="secondary" className="h-4 px-1.5 py-0 text-[10px] leading-none transition-colors">{t("resources.disabled")}</Badge>}
          </div>
          {!skill && <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{t(`resources.${detail.source.scope}`)}</span><span>·</span><span>{detail.source.origin}</span>{!detail.source.writable && <Badge variant="outline">{t("resources.readOnly")}</Badge>}{!detail.enabled && <Badge variant="secondary">{t("resources.disabled")}</Badge>}</div>}
        </div>
        <div className={skill ? "flex shrink-0 items-center gap-2.5" : "flex items-center gap-1"}>
          {skill ? <>
            <Switch checked={detail.enabled} onCheckedChange={(enabled) => void mutate("PATCH", { enabled })} disabled={!skill.canToggle || busy} aria-label={t("resources.enabled")} />
            <TooltipHint content={t("resources.download")}><ResourceIconButton render={<a href={resourceUrl(`skills/${detail.id}/download`, query)} />} aria-label={t("resources.download")}><DownloadIcon /></ResourceIconButton></TooltipHint>
            <TooltipHint content={t("resources.delete")}><ResourceIconButton disabled={!canDelete || busy} onClick={() => setDeleting(true)} aria-label={t("resources.delete")}><Trash2Icon /></ResourceIconButton></TooltipHint>
          </> : <>
            <TooltipHint content={t("resources.edit")}><Button variant="ghost" size="icon-sm" disabled={!detail.source.writable} onClick={() => setEditing(true)} aria-label={t("resources.edit")}><PencilIcon /></Button></TooltipHint>
            <TooltipHint content={t("resources.delete")}><Button variant="ghost" size="icon-sm" disabled={!canDelete || busy} onClick={() => setDeleting(true)} aria-label={t("resources.delete")}><Trash2Icon /></Button></TooltipHint>
          </>}
        </div>
      </div>
      {skill ? <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{skill.description}</p> : <p className="mt-3 break-all font-mono text-xs text-muted-foreground">{detail.source.path || detail.source.label}</p>}
    </div>
    {error && <ResourceErrorState message={error} />}
    {skill ? <SkillContent detail={skill} query={query} file={file} /> : <McpContent detail={detail as McpDetail} query={query} />}
    <AlertDialog open={deleting} onOpenChange={(open) => { if (!busy) setDeleting(open) }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("resources.deleteTitle")}</AlertDialogTitle><AlertDialogDescription>{t(skill ? "resources.deleteSkillHint" : "resources.deleteHint")}</AlertDialogDescription></AlertDialogHeader>
        <p className="break-all text-sm font-medium">{detail.name}</p>{error && <ResourceErrorState message={error} />}
        <AlertDialogFooter><Button variant="outline" disabled={busy} onClick={() => setDeleting(false)}>{t("resources.cancel")}</Button><Button variant="destructive" disabled={busy} onClick={() => void mutate("DELETE")}>{t("resources.delete")}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {!skill && <McpEditor query={query} detail={detail as McpDetail} groups={[]} open={editing} onOpenChange={setEditing} onSaved={(id) => { setEditing(false); onChanged(id) }} />}
  </>
}

function McpContent({ detail, query }: { detail: McpDetail; query: ResourceQuery }) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const [capabilities, setCapabilities] = React.useState<McpCapabilities | null>(null)
  const [testing, setTesting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [tool, setTool] = React.useState<Record<string, unknown> | null>(null)
  const test = async () => {
    setTesting(true); setError(null); setCapabilities(null)
    try { setCapabilities(await resourceRequest<McpCapabilities>(`mcp/${detail.id}/capabilities`, query)) } catch (reason) { setError(errorMessage(reason)) } finally { setTesting(false) }
  }
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-7">
      <div className="min-w-0 text-xs text-muted-foreground"><Badge variant="outline">{detail.transport}</Badge><span className="ml-2">{t(capabilities ? "resources.tested" : "resources.notTested")}</span>{detail.override && <span className="ml-2">· {t("resources.inherited")}</span>}</div>
      <Button variant="outline" size="sm" disabled={testing || !detail.enabled} onClick={() => void test()}><PlayIcon />{t(testing ? "resources.testing" : "resources.test")}</Button>
    </div>
    {error && <ResourceErrorState message={error} />}
    <Tabs defaultValue="tools" className="min-h-0 flex-1 gap-0">
      <div className="overflow-x-auto border-b px-5"><TabsList variant="ghost" size="sm">{(["tools", "prompts", "resources", "configuration"] as const).map((key) => <TabsTrigger key={key} value={key}>{t(`resources.${key}`)}{key !== "configuration" && capabilities && <span className="ml-1 text-xs tabular-nums text-muted-foreground">{capabilities[key].length}</span>}</TabsTrigger>)}</TabsList></div>
      {(["tools", "prompts", "resources"] as const).map((key) => <TabsContent key={key} value={key} className="min-h-0 flex-1 overflow-auto p-5 sm:p-7">
        {testing ? <ResourceLoading /> : !capabilities ? <ResourceEmpty text={t("resources.testHint")} /> : capabilities[key].length === 0 ? <ResourceEmpty text={t("resources.noCapabilities")} /> : <motion.div initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.16 }} className="divide-y rounded-lg border">{capabilities[key].map((entry, index) => {
          const name = typeof entry.name === "string" ? entry.name : t("resources.untitled")
          return <div key={`${name}:${index}`} className="p-4"><div className="flex items-center justify-between gap-2"><h3 className="min-w-0 break-all text-sm font-medium">{name}</h3>{key === "tools" && <Button variant="ghost" size="sm" onClick={() => setTool(entry)}>{t("resources.testTool")}<PlayIcon /></Button>}</div>{typeof entry.description === "string" && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{entry.description}</p>}{key !== "tools" && <CodeBlock code={JSON.stringify(entry, null, 2)} language="json" showHeader={false} maxHeight={200} />}</div>
        })}</motion.div>}
      </TabsContent>)}
      <TabsContent value="configuration" className="min-h-0 flex-1 space-y-5 overflow-auto p-5 sm:p-7"><CodeBlock code={JSON.stringify(detail.definition, null, 2)} language="json" filename={t("resources.configuration")} maxHeight={500} />{detail.override && detail.effectiveDefinition && <CodeBlock code={JSON.stringify(detail.effectiveDefinition, null, 2)} language="json" filename={t("resources.effectiveConfig")} maxHeight={500} />}</TabsContent>
    </Tabs>
    <ToolTestSheet key={tool && typeof tool.name === "string" ? tool.name : "closed"} tool={tool} query={query} serverId={detail.id} onClose={() => setTool(null)} />
  </>
}

function ToolTestSheet({ tool, query, serverId, onClose }: { tool: Record<string, unknown> | null; query: ResourceQuery; serverId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const reduced = useReducedMotion()
  const [args, setArgs] = React.useState("{}")
  const [running, setRunning] = React.useState(false)
  const [result, setResult] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const run = async () => {
    setRunning(true); setError(null); setResult(null)
    try {
      const parsed: unknown = JSON.parse(args)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(t("resources.invalidObject"))
      const output = await resourceRequest<unknown>("mcp/validate/tool", query, jsonRequest("POST", { id: serverId, name: tool?.name, args: parsed }))
      setResult(JSON.stringify(output, null, 2))
    } catch (reason) { setError(errorMessage(reason)) } finally { setRunning(false) }
  }
  return <Sheet open={Boolean(tool)} onOpenChange={(open) => { if (!open) onClose() }}><SheetContent className="data-[side=right]:w-full sm:data-[side=right]:w-[min(540px,90vw)] sm:data-[side=right]:max-w-none">
    <SheetHeader><SheetTitle>{typeof tool?.name === "string" ? tool.name : t("resources.testTool")}</SheetTitle><SheetDescription>{t("resources.toolHint")}</SheetDescription></SheetHeader>
    <div className="min-h-0 flex-1 space-y-5 overflow-auto px-5 pb-5">
      {typeof tool?.description === "string" && <p className="text-sm text-muted-foreground">{tool.description}</p>}
      <CodeBlock code={JSON.stringify(tool?.inputSchema ?? {}, null, 2)} filename={t("resources.schema")} language="json" maxHeight={250} />
      <div className="space-y-2"><Label htmlFor="mcp-tool-arguments">{t("resources.arguments")}</Label><Textarea id="mcp-tool-arguments" value={args} onChange={(event) => setArgs(event.target.value)} className="min-h-32 font-mono text-xs" spellCheck={false} disabled={running} /></div>
      <Button onClick={() => void run()} disabled={running}><PlayIcon />{t(running ? "resources.testing" : "resources.runTool")}</Button>
      {error && <ResourceErrorState message={error} />}
      {result && <motion.div initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.16 }}><CodeBlock code={result} filename={t("resources.result")} language="json" maxHeight={500} /></motion.div>}
    </div>
  </SheetContent></Sheet>
}
