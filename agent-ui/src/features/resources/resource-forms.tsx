import * as React from "react"
import { PlayIcon, UploadIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import FileUploadDropzone1 from "@/components/file-upload-dropzone-1"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { errorMessage, jsonRequest, resourceRequest, type McpDetail, type ResourceGroup, type ResourceKind, type ResourceQuery, type SkillDetail } from "./resource-api"
import { MAX_SKILL_ARCHIVE_BYTES, SKILL_ARCHIVE_ACCEPT, validateSkillArchive } from "./skill-upload"

type FormProps = {
  query: ResourceQuery; groups: ResourceGroup[]; open: boolean; onOpenChange: (open: boolean) => void
  onSaved: (id: string, cwd?: string) => void
}

export function ResourceCreateDialog({ kind, ...props }: FormProps & { kind: ResourceKind }) {
  // Mount fresh forms on open so closing a draft does not silently reuse stale source or provider state.
  if (!props.open) return null
  return kind === "skills" ? <SkillUpload {...props} /> : <McpEditor {...props} />
}

function SkillUpload({ query, open, onOpenChange, onSaved }: FormProps) {
  const { t } = useTranslation()
  const [scope, setScope] = React.useState("global")
  const [cwd, setCwd] = React.useState(query.cwd ?? "")
  const [files, setFiles] = React.useState<File[]>([])
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const errorId = React.useId()
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(null)
    const file = files[0]
    if (!file) { setError(t("resources.fileRequired")); return }
    setBusy(true)
    try {
      const body = new FormData(); body.set("file", file)
      const context = scope === "project" ? { ...query, cwd } : query
      const uploaded = await resourceRequest<SkillDetail>("skills/upload", context, { method: "POST", body }, { scope })
      onOpenChange(false); onSaved(uploaded.id, scope === "project" ? cwd : undefined)
    } catch (reason) { setError(errorMessage(reason)) } finally { setBusy(false) }
  }
  return <Dialog open={open} onOpenChange={(value) => { if (!busy) onOpenChange(value) }}><DialogContent>
    <DialogHeader><DialogTitle>{t("resources.upload")}</DialogTitle><DialogDescription>{t("resources.archiveHint")}</DialogDescription></DialogHeader>
    <form onSubmit={(event) => void submit(event)} className="space-y-5">
      <FormField label={t("resources.scope")}><Select value={scope} onValueChange={(value) => setScope(value ?? "global")}><SelectTrigger className="w-full" aria-label={t("resources.scope")}><SelectValue>{t(scope === "global" ? "resources.global" : "resources.project")}</SelectValue></SelectTrigger><SelectContent><SelectItem value="global">{t("resources.global")}</SelectItem><SelectItem value="project">{t("resources.project")}</SelectItem></SelectContent></Select></FormField>
      {scope === "project" && <FormField label={t("resources.directory")}><Input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="/path/to/project" required autoComplete="off" /></FormField>}
      <FileUploadDropzone1
        value={files} onValueChange={setFiles} accept={SKILL_ARCHIVE_ACCEPT} maxFiles={1} maxSize={MAX_SKILL_ARCHIVE_BYTES}
        disabled={busy} multiple={false} label={t("resources.archive")} invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
        onClickCapture={() => setError(null)} onDropCapture={() => setError(null)}
        onFileValidate={(file) => { const key = validateSkillArchive(file); return key ? t(key) : undefined }}
        onFileReject={(file) => setError(t(validateSkillArchive(file) ?? "resources.archiveSingle"))}
        labels={{ title: t("resources.archiveDrop"), description: t("resources.archiveLimit"), browse: t("resources.archiveBrowse"), remove: t("resources.archiveRemove") }}
      />
      {error && <p id={errorId} role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{t("resources.cancel")}</Button><Button type="submit" disabled={busy || files.length === 0}><UploadIcon />{t(busy ? "resources.saving" : "resources.upload")}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>
}

export function McpEditor(props: FormProps & { detail?: McpDetail }) {
  if (!props.open) return null
  return <McpEditorForm {...props} />
}

function McpEditorForm({ query, groups, detail, open, onOpenChange, onSaved }: FormProps & { detail?: McpDetail }) {
  const { t } = useTranslation()
  const [initial, setInitial] = React.useState<Record<string, unknown>>(detail?.definition ?? {})
  const sources = groups.map((group) => group.source).filter((source) => source.canAdd)
  const defaultSource = sources.find((source) => source.origin === "settings" && source.scope === "global") ?? sources[0]
  const [sourceId, setSourceId] = React.useState(defaultSource?.id ?? "custom-project")
  const [cwd, setCwd] = React.useState(query.cwd ?? "")
  const [name, setName] = React.useState(detail?.name ?? "")
  const [transport, setTransport] = React.useState(initial.command ? "stdio" : (initial.type === "sse" || initial.httpTransport === "sse") ? "sse" : "http")
  const [url, setUrl] = React.useState(typeof initial.url === "string" ? initial.url : "")
  const [command, setCommand] = React.useState(typeof initial.command === "string" ? initial.command : "")
  const [args, setArgs] = React.useState(JSON.stringify(initial.args ?? []))
  const [headers, setHeaders] = React.useState(JSON.stringify(initial.headers ?? {}, null, 2))
  const [env, setEnv] = React.useState(JSON.stringify(initial.env ?? {}, null, 2))
  const [advanced, setAdvanced] = React.useState(Boolean(detail && !initial.command && !initial.url))
  const [raw, setRaw] = React.useState(JSON.stringify(initial, null, 2))
  const [busy, setBusy] = React.useState<"save" | "test" | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [tested, setTested] = React.useState(false)
  const object = (text: string): Record<string, unknown> => {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(t("resources.invalidObject"))
    return parsed as Record<string, unknown>
  }
  const definition = () => {
    if (advanced) return object(raw)
    const value = Object.fromEntries(Object.entries(initial).filter(([key]) => !["command", "args", "url", "type", "headers", "env"].includes(key)))
    if (transport === "stdio") {
      const parsed: unknown = JSON.parse(args)
      if (!Array.isArray(parsed) || parsed.some((arg) => typeof arg !== "string")) throw new Error(t("resources.invalidArray"))
      return { ...value, command, args: parsed, env: object(env) }
    }
    return { ...value, type: transport, url, headers: object(headers) }
  }
  const source = sources.find((entry) => entry.id === sourceId)
  const context: ResourceQuery = !detail && sourceId === "custom-project" ? { ...query, cwd } : source?.cwd ? { ...query, cwd: source.cwd } : query
  const submit = async (mode: "save" | "test") => {
    setBusy(mode); setError(null); setTested(false)
    try {
      const config = definition()
      if (mode === "test") {
        await resourceRequest("mcp/validate", context, jsonRequest("POST", { definition: config })); setTested(true)
      } else {
        const saved = detail ? await resourceRequest<McpDetail>(`mcp/${detail.id}`, query, jsonRequest("PATCH", { definition: config })) : await resourceRequest<McpDetail>("mcp", context, jsonRequest("POST", { name, definition: config, ...(sourceId === "custom-project" ? { scope: "project" } : { sourceId }) }))
        onOpenChange(false); onSaved(saved.id, context.cwd)
      }
    } catch (reason) { setError(errorMessage(reason)) } finally { setBusy(null) }
  }
  const toggleAdvanced = (next: boolean) => {
    try {
      if (next) setRaw(JSON.stringify(definition(), null, 2))
      else {
        const config = object(raw)
        if (!config.command && !config.url) throw new Error(t("resources.formUnavailable"))
        setInitial(config)
        setTransport(config.command ? "stdio" : (config.type === "sse" || config.httpTransport === "sse") ? "sse" : "http")
        setCommand(typeof config.command === "string" ? config.command : "")
        setUrl(typeof config.url === "string" ? config.url : "")
        setArgs(JSON.stringify(config.args ?? []))
        setHeaders(JSON.stringify(config.headers ?? {}, null, 2))
        setEnv(JSON.stringify(config.env ?? {}, null, 2))
      }
      setAdvanced(next); setError(null); setTested(false)
    } catch (reason) { setError(errorMessage(reason)) }
  }
  return <Dialog open={open} onOpenChange={(value) => { if (!busy) onOpenChange(value) }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
    <DialogHeader><DialogTitle>{t(detail ? "resources.edit" : "resources.add")}</DialogTitle><DialogDescription>{t("resources.nextTurn")}</DialogDescription></DialogHeader>
    <form className="space-y-4" onChange={() => setTested(false)} onSubmit={(event) => { event.preventDefault(); void submit("save") }}>
      {!detail && <FormField label={t("resources.source")}><Select value={sourceId} onValueChange={(value) => setSourceId(value ?? "custom-project")}><SelectTrigger className="w-full" aria-label={t("resources.source")}><SelectValue>{source?.label ?? t("resources.directory")}</SelectValue></SelectTrigger><SelectContent>{sources.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.label}</SelectItem>)}<SelectItem value="custom-project">{t("resources.directory")}…</SelectItem></SelectContent></Select></FormField>}
      {!detail && sourceId === "custom-project" && <FormField label={t("resources.directory")}><Input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="/path/to/project" required /></FormField>}
      <div className="grid gap-4 sm:grid-cols-2"><FormField label={t("resources.name")}><Input value={name} onChange={(event) => setName(event.target.value)} required disabled={Boolean(detail)} autoComplete="off" /></FormField>
        <FormField label={t("resources.transport")}><Select value={transport} disabled={advanced} onValueChange={(value) => setTransport(value ?? "http")}><SelectTrigger className="w-full" aria-label={t("resources.transport")}><SelectValue>{transport === "stdio" ? "stdio" : transport.toUpperCase()}</SelectValue></SelectTrigger><SelectContent><SelectItem value="http">HTTP</SelectItem><SelectItem value="sse">SSE</SelectItem><SelectItem value="stdio">stdio</SelectItem></SelectContent></Select></FormField></div>
      {!advanced && (transport === "stdio" ? <>
        <FormField label={t("resources.command")}><Input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="npx" required autoComplete="off" /></FormField>
        <FormField label={t("resources.commandArgs")}><Input className="font-mono text-xs" value={args} onChange={(event) => setArgs(event.target.value)} spellCheck={false} /></FormField>
        <FormField label={t("resources.env")}><Textarea className="font-mono text-xs" value={env} onChange={(event) => setEnv(event.target.value)} spellCheck={false} /></FormField>
      </> : <><FormField label={t("resources.url")}><Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/mcp" required autoComplete="off" /></FormField><FormField label={t("resources.headers")}><Textarea className="font-mono text-xs" value={headers} onChange={(event) => setHeaders(event.target.value)} spellCheck={false} /></FormField></>)}
      <Button type="button" variant="ghost" size="sm" onClick={() => toggleAdvanced(!advanced)} aria-pressed={advanced}>{advanced ? t("resources.configuration") : t("resources.advanced")}</Button>
      {advanced && <FormField label={t("resources.advanced")}><Textarea value={raw} onChange={(event) => setRaw(event.target.value)} className="min-h-60 font-mono text-xs" spellCheck={false} /></FormField>}
      <p className="text-xs text-muted-foreground">{t("resources.advancedHint")}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{tested && <p role="status" className="text-sm">{t("resources.draftTested")}</p>}
      <DialogFooter><Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => void submit("test")}><PlayIcon />{t(busy === "test" ? "resources.testing" : "resources.test")}</Button><Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => onOpenChange(false)}>{t("resources.cancel")}</Button><Button type="submit" disabled={Boolean(busy)}>{t(busy === "save" ? "resources.saving" : "resources.save")}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>
}

function FormField({ label, children }: { label: string; children: React.ReactElement<{ id?: string; "aria-label"?: string }> }) {
  const id = React.useId()
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{React.cloneElement(children, { id, "aria-label": label })}</div>
}
