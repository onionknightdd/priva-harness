import { useEffect, useId, useMemo, useRef, useState } from "react"
import { ArrowLeft, Check, ChevronDown, ChevronRight, FileCode2, GitBranch, GitCommitHorizontal, History, LoaderCircle, Minus, MoveRight, Plus, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FileTypeIcon } from "@/features/file-browser/components/file-type-icon"
import { readGitCommit, readGitDiff, readGitHistory, type GitChange, type GitCommit, type GitCommitDetails, type GitDiff } from "@/lib/api/git-repository"
import { cn } from "@/lib/utils"
import { GitBranchMenu } from "./git-branch-menu"
import { GitUpstreamMenu } from "./git-upstream-menu"
import { groupGitChanges } from "./git-data"
import { GitDiffContent } from "./git-diff-content"
import { GitEmpty, GitIconButton, GitModeTabs, GitNotice } from "./git-ui-primitives"
import { gitStatusClass } from "./git-status-style"
import { useGitText } from "./git-ui-text"
import type { GitRepositoryController } from "./use-git-repository"

export type GitChangeArea = "staged" | "unstaged" | "untracked" | "conflicted"
export type GitSelection = { kind: "change"; path: string; area: GitChangeArea } | { kind: "commit"; commitId: string; path?: string }

function errorText(error: unknown) { return error instanceof Error ? error.message : String(error) }
function baseName(path: string) { return path.split("/").at(-1) || path }

function ChangeGroup({ area, changes, selection, onSelectionChange, controller }: {
  area: GitChangeArea; changes: GitChange[]; selection: GitSelection | null; onSelectionChange: (selection: GitSelection) => void; controller: GitRepositoryController
}) {
  const t = useGitText()
  const id = useId()
  const [expanded, setExpanded] = useState(true)
  const unstage = area === "staged"
  if (!changes.length) return null
  return <section className="mb-1">
    <div className="flex h-7 items-center gap-1 px-2">
      <Button variant="ghost" size="xs" className="h-7 min-w-0 flex-1 justify-start gap-1 px-0 text-xs font-medium" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <span>{t[area]}</span><span className="ml-1 font-normal text-muted-foreground tabular-nums">{changes.length}</span>
      </Button>
      {area !== "conflicted" && <GitIconButton label={unstage ? t.unstageAll : t.stageAll} disabled={Boolean(controller.busy)} onClick={() => void controller.perform({ action: unstage ? "unstage" : "stage", paths: changes.map((change) => change.path) })}>{unstage ? <Minus /> : <Plus />}</GitIconButton>}
    </div>
    <div id={id} hidden={!expanded}>
      {changes.map((change) => {
        const status = area === "conflicted" ? "!" : area === "untracked" ? "?" : area === "staged" ? change.indexStatus : change.worktreeStatus
        const selected = selection?.kind === "change" && selection.path === change.path && selection.area === area
        const parent = change.path.includes("/") ? change.path.slice(0, change.path.lastIndexOf("/")) : ""
        return <div key={change.path} className={cn("group/git-file flex h-[26px] items-center gap-1 rounded-sm pr-2 pl-4 text-xs hover:bg-sidebar-accent", selected && "bg-sidebar-active")}>
          <button type="button" className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" aria-pressed={selected} title={change.originalPath ? `${change.originalPath} → ${change.path}` : change.path} onClick={() => onSelectionChange({ kind: "change", area, path: change.path })}>
            <FileTypeIcon name={baseName(change.path)} path={change.path} /><span className="truncate">{baseName(change.path)}</span><span className="min-w-0 truncate text-[11px] text-muted-foreground/70">{parent}</span>
          </button>
          <span className={cn("w-4 shrink-0 text-center font-mono text-[11px]", gitStatusClass(status))} title={status === "!" ? t.conflicted : status === "?" ? t.untracked : status === "A" ? t.added : status === "D" ? t.deleted : status === "R" ? t.renamed : t.modified}>{status}</span>
          <GitIconButton label={`${unstage ? t.unstage : t.stage}: ${change.path}`} disabled={Boolean(controller.busy)} className="opacity-0 group-hover/git-file:opacity-100 group-focus-within/git-file:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none" onClick={() => void controller.perform({ action: unstage ? "unstage" : "stage", paths: [change.path] })}>{unstage ? <Minus /> : <Plus />}</GitIconButton>
        </div>
      })}
    </div>
  </section>
}

function GitHistoryList({ cwd, head, active, selection, onSelectionChange }: { cwd: string; head: string | null; active: boolean; selection: GitSelection | null; onSelectionChange: (selection: GitSelection) => void }) {
  const t = useGitText()
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const request = useRef<AbortController | null>(null)
  const identity = `${cwd}\0${head}`
  const identityRef = useRef(identity)
  identityRef.current = identity
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError(null)
    void readGitHistory(cwd, { limit: 50 }, controller.signal).then((result) => {
      if (!controller.signal.aborted) { setCommits(result.commits); setHasMore(result.hasMore); setLoading(false) }
    }, (reason: unknown) => { if (!controller.signal.aborted) { setError(errorText(reason)); setLoading(false) } })
    return () => { controller.abort(); request.current?.abort() }
  }, [active, cwd, head, retry])
  const loadMore = async () => {
    if (loading || request.current?.signal.aborted) return
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    setLoading(true)
    setError(null)
    try {
      const result = await readGitHistory(cwd, { skip: commits.length, limit: 50 }, controller.signal)
      if (!controller.signal.aborted && identityRef.current === identity) { setCommits((current) => [...current, ...result.commits]); setHasMore(result.hasMore) }
    } catch (reason) {
      if (!controller.signal.aborted && identityRef.current === identity) setError(errorText(reason))
    } finally { if (!controller.signal.aborted && identityRef.current === identity) setLoading(false) }
  }
  return <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
    {commits.map((commit) => <button type="button" key={commit.id} onClick={() => onSelectionChange({ kind: "commit", commitId: commit.id })} aria-pressed={selection?.kind === "commit" && selection.commitId === commit.id} className={cn("flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-xs outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", selection?.kind === "commit" && selection.commitId === commit.id && "bg-sidebar-active")}>
      <GitCommitHorizontal className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block truncate" title={commit.subject}>{commit.subject}</span><span className="mt-1 flex min-w-0 gap-2 text-[11px] text-muted-foreground"><span className="shrink-0 font-mono">{commit.shortId}</span><span className="truncate">{commit.authorName}</span><time className="ml-auto shrink-0" dateTime={commit.authoredAt} title={commit.authoredAt}>{new Date(commit.authoredAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time></span></span>
    </button>)}
    {error && <><GitNotice error>{error}</GitNotice><Button size="xs" variant="ghost" onClick={() => setRetry((value) => value + 1)}>{t.retry}</Button></>}
    {loading && <GitNotice>{t.loadingHistory}</GitNotice>}
    {!loading && !error && !commits.length && <GitEmpty icon={<History />} title={t.noHistory} />}
    {hasMore && !loading && <Button size="xs" variant="ghost" className="mx-2 mt-2" onClick={() => void loadMore()}>{t.loadMore}</Button>}
  </div>
}

export function GitTreePane({ controller, selection, onSelectionChange, active }: { controller: GitRepositoryController; selection: GitSelection | null; onSelectionChange: (selection: GitSelection) => void; active: boolean }) {
  const t = useGitText()
  const { repository, loading, error, busy, actionError, actionMessage, refresh } = controller
  const [tab, setTab] = useState("changes")
  const root = repository?.root ?? ""
  const groups = useMemo(() => groupGitChanges(repository?.changes ?? []), [repository?.changes])
  if (!repository?.root) return <div className="flex min-h-0 flex-1 flex-col">
    {loading ? <GitNotice>{t.loading}</GitNotice> : error ? <><GitNotice error>{error}</GitNotice><Button variant="ghost" size="xs" className="mx-3 self-start" onClick={refresh}>{t.retry}</Button></> : <GitEmpty icon={<GitBranch />} title={t.notRepository}>{t.chooseRepository}</GitEmpty>}
  </div>
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col text-xs" aria-busy={Boolean(busy)}>
    <div data-git-repository-header className="flex min-w-0 shrink-0 items-center gap-1 border-b px-3 py-2">
      <span className="min-w-0 max-w-[25%] shrink truncate text-sm font-semibold" title={root}>{baseName(root)}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <GitBranchMenu key={root} controller={controller} />
        <MoveRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
        <GitUpstreamMenu key={`${root}:${repository.branch}`} controller={controller} />
      </div>
      <GitIconButton label={t.refresh} disabled={Boolean(busy)} busy={loading} onClick={refresh}><RefreshCw /></GitIconButton>
    </div>
    <div className="shrink-0 px-2 py-2"><GitModeTabs value={tab} onChange={setTab} label="Git" items={[{ value: "changes", label: t.changes }, { value: "history", label: t.history }]} /></div>
    {actionError && <GitNotice error>{actionError}</GitNotice>}
    {actionMessage && !actionError && <div role="status" className="max-h-20 shrink-0 overflow-auto whitespace-pre-wrap break-words px-3 pb-2 text-[11px] text-muted-foreground">{actionMessage}</div>}
    {repository.operation && <GitNotice>{repository.operation === "merge" ? t.mergeProgress : `${repository.operation} · ${t.operationBlocked}`}</GitNotice>}
    <div className={cn("min-h-0 flex-1 overflow-y-auto", tab !== "changes" && "hidden")}>
      {(["conflicted", "staged", "unstaged", "untracked"] as const).map((area) => <ChangeGroup key={area} area={area} changes={groups[area]} selection={selection} onSelectionChange={onSelectionChange} controller={controller} />)}
      {!repository.changes.length && <GitEmpty icon={<Check />} title={t.clean}>{t.cleanDescription}</GitEmpty>}
    </div>
    <div className={cn("min-h-0 flex-1 flex-col", tab === "history" ? "flex" : "hidden")}><GitHistoryList key={`${root}:${repository.commit}`} cwd={root} head={repository.commit} active={active && tab === "history"} selection={selection} onSelectionChange={onSelectionChange} /></div>
  </div>
}

type ReadState<T> = { key: string; data: T | null; loading: boolean; error: string | null }

export function GitPreviewPane({ controller, selection, onSelectionChange, onBack, onOpenFile, active }: {
  controller: GitRepositoryController; selection: GitSelection | null; onSelectionChange: (selection: GitSelection) => void; onBack?: () => void; onOpenFile: (path: string) => void; active: boolean
}) {
  const t = useGitText()
  const { repository, busy, perform } = controller
  const root = repository?.root
  const commitId = selection?.kind === "commit" ? selection.commitId : null
  const commitKey = `${root ?? ""}\0${commitId ?? ""}`
  const [commitState, setCommitState] = useState<ReadState<GitCommitDetails>>({ key: "", data: null, loading: false, error: null })
  const [diffState, setDiffState] = useState<ReadState<GitDiff>>({ key: "", data: null, loading: false, error: null })
  const [retry, setRetry] = useState(0)
  const [mode, setMode] = useState("diff")
  const [split, setSplit] = useState(false)
  const [wide, setWide] = useState(false)
  const paneRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const pane = paneRef.current
    if (!pane) return
    const observer = new ResizeObserver(() => setWide(pane.clientWidth >= 760))
    observer.observe(pane)
    setWide(pane.clientWidth >= 760)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!active || !root || !commitId) return
    const abort = new AbortController()
    setCommitState((current) => ({ key: commitKey, data: current.key === commitKey ? current.data : null, loading: true, error: null }))
    void readGitCommit(root, commitId, abort.signal).then((data) => { if (!abort.signal.aborted) setCommitState({ key: commitKey, data, loading: false, error: null }) }, (error: unknown) => { if (!abort.signal.aborted) setCommitState({ key: commitKey, data: null, loading: false, error: errorText(error) }) })
    return () => abort.abort()
  }, [active, root, commitId, commitKey, retry])
  const commitDetails = commitState.key === commitKey ? commitState.data : null
  const path = selection?.kind === "change" ? selection.path : selection?.path ?? commitDetails?.files[0]?.path
  const area = selection?.kind === "change" ? selection.area === "conflicted" ? "unstaged" : selection.area : "commit"
  const diffKey = `${root ?? ""}\0${commitId ?? ""}\0${area}\0${path ?? ""}`
  const hasSelection = Boolean(selection)
  const change = repository?.changes.find((item) => item.path === path)
  const noRemainingChanges = selection?.kind === "change" && !change
  const currentGroups = useMemo(() => groupGitChanges(change ? [change] : []), [change])
  useEffect(() => {
    if (!active || !root || selection?.kind !== "change" || !change || currentGroups[selection.area].length) return
    const nextArea = (["conflicted", "staged", "unstaged", "untracked"] as const).find((candidate) => currentGroups[candidate].length)
    if (nextArea) onSelectionChange({ ...selection, area: nextArea })
  }, [active, root, selection, change, currentGroups, onSelectionChange])
  useEffect(() => {
    if (!active || !root || !path || !hasSelection || noRemainingChanges) return
    const abort = new AbortController()
    setDiffState((current) => ({ key: diffKey, data: current.key === diffKey ? current.data : null, loading: true, error: null }))
    void readGitDiff(root, { path, area, ...(commitId ? { commit: commitId } : {}) }, abort.signal).then((data) => { if (!abort.signal.aborted) setDiffState({ key: diffKey, data, loading: false, error: null }) }, (error: unknown) => { if (!abort.signal.aborted) setDiffState({ key: diffKey, data: null, loading: false, error: errorText(error) }) })
    return () => abort.abort()
  }, [active, root, path, area, commitId, diffKey, repository, retry, hasSelection, noRemainingChanges])
  const diff = !noRemainingChanges && diffState.key === diffKey ? diffState.data : null
  const error = commitId && commitState.key === commitKey && commitState.error || !noRemainingChanges && diffState.key === diffKey && diffState.error || null
  const conflicted = selection?.kind === "change" && selection.area === "conflicted"
  const canStage = selection?.kind === "change" && currentGroups[selection.area].length > 0
  const unstage = selection?.kind === "change" && selection.area === "staged"

  return <div ref={paneRef} className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-xs">
    <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
      {onBack && <GitIconButton label={t.back} onClick={onBack}><ArrowLeft /></GitIconButton>}
      <FileCode2 className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate font-medium" title={path}>{path ? baseName(path) : commitDetails?.commit.subject ?? "Git"}</span>
      {path && <GitModeTabs value={mode} onChange={setMode} label={t.diff} items={[{ value: "diff", label: t.diff }, { value: "source", label: t.source }]} />}
      {wide && mode === "diff" && path && <GitModeTabs value={split ? "split" : "inline"} onChange={(next) => setSplit(next === "split")} label={t.split} items={[{ value: "inline", label: t.inline }, { value: "split", label: t.split }]} />}
    </div>
    {!selection || !root ? <div className="flex flex-1 items-center justify-center">{!root && controller.loading ? <GitNotice>{t.loading}</GitNotice> : !root && controller.error ? <GitNotice error>{controller.error}</GitNotice> : <GitEmpty icon={<GitBranch />} title={!root ? t.notRepository : t.noSelection}>{!root ? t.chooseRepository : t.selectionHint}</GitEmpty>}</div> : <>
      {commitId && !commitDetails && !error && <GitNotice>{t.loading}</GitNotice>}
      {commitDetails && <div className="max-h-[40%] shrink-0 overflow-y-auto border-b px-3 py-3">
        <p className="break-words font-medium">{commitDetails.commit.subject}</p><p className="mt-1 break-words text-[11px] text-muted-foreground"><span className="font-mono" title={commitDetails.commit.id}>{commitDetails.commit.shortId}</span> · {commitDetails.commit.authorName} · <time dateTime={commitDetails.commit.authoredAt}>{new Date(commitDetails.commit.authoredAt).toLocaleString()}</time></p>
        {commitDetails.commit.body && <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">{commitDetails.commit.body}</p>}
        <p className="mt-3 mb-1 text-[11px] text-muted-foreground">{t.changedFiles} · {commitDetails.files.length}</p>
        {commitDetails.files.map((file) => <button key={file.path} type="button" className={cn("flex h-[26px] w-full items-center gap-2 rounded-sm px-1 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", path === file.path && "bg-muted")} aria-pressed={path === file.path} title={file.originalPath ? `${file.originalPath} → ${file.path}` : file.path} onClick={() => onSelectionChange({ kind: "commit", commitId: commitDetails.commit.id, path: file.path })}>
          <FileTypeIcon name={baseName(file.path)} path={file.path} /><span className="min-w-0 flex-1 truncate">{file.path}</span><span className={cn("w-4 text-center font-mono text-[11px]", gitStatusClass(file.status))}>{file.status}</span>{file.additions !== null && <span className="text-status-success tabular-nums">+{file.additions}</span>}{file.deletions !== null && <span className="text-status-error tabular-nums">−{file.deletions}</span>}
        </button>)}
        {!commitDetails.files.length && <GitNotice>{t.noCommitFiles}</GitNotice>}
      </div>}
      {conflicted && <div className="shrink-0 border-b bg-status-warning/5"><GitNotice>{t.conflictDescription}</GitNotice></div>}
      {diff && <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-[11px] text-muted-foreground"><span className="min-w-0 flex-1 truncate" title={`${diff.oldLabel} → ${diff.newLabel}`}>{diff.oldLabel} → {diff.newLabel}</span>{diffState.loading && <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-label={t.loading} />}</div>}
      {noRemainingChanges ? <GitEmpty icon={<Check />} title={t.noRemainingChanges} /> : error ? <div className="p-2"><GitNotice error>{error}</GitNotice><Button variant="ghost" size="xs" onClick={() => setRetry((value) => value + 1)}>{t.retry}</Button></div> : path && !diff ? <GitNotice>{t.loading}</GitNotice> : diff ? <GitDiffContent diff={diff} source={mode === "source"} split={split && wide} /> : null}
      {path && <div className="mt-auto flex shrink-0 flex-wrap items-center gap-2 border-t px-3 py-2">
        {selection.kind === "change" && <Button size="xs" variant="outline" disabled={Boolean(busy) || !canStage} onClick={() => void perform({ action: unstage ? "unstage" : "stage", paths: [path] })}>{unstage ? <Minus className="size-4" /> : <Plus className="size-4" />}{unstage ? t.unstage : t.stage}</Button>}
        <Button size="xs" variant="ghost" className="ml-auto" onClick={() => onOpenFile(`${root.replace(/\/$/, "")}/${path}`)}><FileCode2 className="size-4" />{t.openFile}</Button>
      </div>}
    </>}
  </div>
}
