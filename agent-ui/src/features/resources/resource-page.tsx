import * as React from "react"
import { ArrowLeftIcon, CableIcon, ChevronRightIcon, LockKeyholeIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { ResourceListHeader } from "./resource-list-header"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { collapsePanel } from "@/lib/surfaces"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Separator } from "@/components/ui/separator"
import { useIsMobile } from "@/hooks/use-mobile"
import { useHarness } from "@/features/sidebar/header/harness-context"
import { cn } from "@/lib/utils"
import { filterResourceGroups, groupResourcesByProject, resourceSourceLabel, resourceRequest, type SkillDetail, type ResourceDetail, type ResourceGroup, type ResourceKind, type ResourceList, type ResourceQuery } from "./resource-api"
import { ResourceLoading, ResourceEmpty, ResourceErrorState } from "./resource-shared"
import { createResourceCache, useResource } from "./resource-hooks"
import { SkillResourceTree } from "./skill-resource-tree"
import { TooltipHint } from "@/components/ui/tooltip"

const ResourceDetailPane = React.lazy(async () => ({ default: (await import("./resource-detail")).ResourceDetailPane }))
const ResourceCreateDialog = React.lazy(async () => ({ default: (await import("./resource-forms")).ResourceCreateDialog }))

const CachedResourceDetailPane = React.memo(function CachedResourceDetailPane({ kind, detail, query, file, onChanged, onSkillUpdated }: {
  kind: ResourceKind; detail: ResourceDetail; query: ResourceQuery; file: string | null
  onChanged: (id?: string) => void; onSkillUpdated: (detail: SkillDetail) => Promise<void>
}) {
  const context = React.useMemo(() => kind === "mcp" && detail.source.cwd ? { ...query, cwd: detail.source.cwd } : query, [kind, detail.source.cwd, query])
  return <ResourceDetailPane kind={kind} detail={detail} query={context} file={file ?? "SKILL.md"} onChanged={onChanged} onSkillUpdated={onSkillUpdated} />
})

export function ResourcePage({ kind }: { kind: ResourceKind }) {
  const { runHarnessId } = useHarness()
  const { t } = useTranslation()
  if (!runHarnessId) return <ResourceEmpty text={t("resources.unsupported")} />
  return <ResourceBrowser key={`${kind}:${runHarnessId}`} kind={kind} harness={runHarnessId} />
}

export function ResourceBrowser({ kind, harness }: { kind: ResourceKind; harness: ResourceQuery["harness"] }) {
  const { t } = useTranslation()
  const mobile = useIsMobile()
  const [cwd, setCwd] = React.useState("")
  const [revision, refresh] = React.useReducer((value: number) => value + 1, 0)
  const [search, setSearch] = React.useState("")
  const [selected, setSelected] = React.useState<string | null>(null)
  const [recentDetails, setRecentDetails] = React.useState<{ id: string; file: string | null }[]>([])
  const file = recentDetails.find((entry) => entry.id === selected)?.file ?? null
  const [creating, setCreating] = React.useState(false)
  const query = React.useMemo<ResourceQuery>(() => ({ harness, ...(cwd ? { cwd } : {}) }), [harness, cwd])
  const detailScope = React.useMemo(() => ({ query, revision, statusVersion: 0, cache: createResourceCache<ResourceDetail>() }), [query, revision])
  const activeScope = React.useRef(detailScope)
  React.useLayoutEffect(() => { activeScope.current = detailScope }, [detailScope])
  const list = useResource<ResourceList>(kind, query, revision)
  const detail = useResource<ResourceDetail>(selected ? `${kind}/${selected}` : null, detailScope.query, detailScope.revision, detailScope.cache)
  const [syncedSkills, setSyncedSkills] = React.useState<{ scope: typeof detailScope; list: ResourceList | null } | null>(null)
  const listData = syncedSkills?.scope === detailScope ? syncedSkills.list ?? list.data : list.data
  const onSkillUpdated = React.useCallback(async (updated: SkillDetail) => {
    if (activeScope.current !== detailScope) return
    const statusVersion = ++detailScope.statusVersion
    const entry = detailScope.cache.get(`skills/${updated.id}`)
    if (entry) entry.state = { data: updated, loading: false, error: null }
    setSyncedSkills((current) => ({ scope: detailScope, list: current?.scope === detailScope ? current.list : null }))
    // Native permissions can affect same-name skills in other sources. Refresh
    // their statuses in the background without resetting trees or previews.
    const next = await resourceRequest<ResourceList>("skills", detailScope.query)
    if (activeScope.current !== detailScope || statusVersion !== detailScope.statusVersion) return
    for (const group of next.groups) for (const item of group.items) {
      const cached = detailScope.cache.get(`skills/${item.id}`)
      if (cached?.state.data) cached.state = { ...cached.state, data: { ...cached.state.data, ...item } }
    }
    setSyncedSkills({ scope: detailScope, list: next })
  }, [detailScope])
  const groups = filterResourceGroups(listData?.groups ?? [], search)
  const sections = groupResourcesByProject(groups)
  const selectFile = React.useCallback((id: string, path: string | null) => {
    setSelected(id)
    // Keep the three recent details mounted so returning preserves previews,
    // connection results, tabs and scroll without retaining an unbounded DOM.
    setRecentDetails((previous) => previous[0]?.id === id && previous[0].file === path ? previous : [{ id, file: path }, ...previous.filter((entry) => entry.id !== id)].slice(0, 3))
  }, [])
  const changed = React.useCallback((id?: string, context?: string) => {
    if (context && context !== cwd) setCwd(context)
    if (id) selectFile(id, null)
    else setSelected(null)
    refresh()
  }, [cwd, selectFile])
  const renderItems = (sourceGroups: ResourceGroup[]) => sourceGroups.every((group) => group.items.length === 0)
    ? <p className="px-2 py-2 text-xs text-muted-foreground">{t("resources.empty")}</p>
    : sourceGroups.flatMap((group) => group.items.map((item) => "filePath" in item ? (
      <SkillResourceTree key={item.id} skill={(detailScope.cache.get(`skills/${item.id}`)?.state.data as SkillDetail | undefined) ?? item} source={group.source} query={detailScope.query} revision={detailScope.revision} cache={detailScope.cache} selected={selected === item.id} file={selected === item.id ? file : null} mobile={mobile} onSelect={selectFile} onRetry={refresh} />
    ) : (
      <div key={item.id}>
        <TooltipHint content={`${item.name}\n${resourceSourceLabel(group.source)}\n${group.source.path}`}>
          <Button variant="ghost" className={cn("h-[26px] w-full justify-start gap-2 border-0 px-2 py-[3px] text-left text-xs motion-reduce:transition-none", selected === item.id && "bg-accent text-accent-foreground")} data-mcp-item={item.id} aria-pressed={selected === item.id} onClick={() => selectFile(item.id, null)}>
            <CableIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
            {!group.source.writable && <LockKeyholeIcon className="size-3 shrink-0 text-muted-foreground" aria-label={t("resources.readOnly")} />}
            {!item.enabled && <Badge variant="secondary" className="h-4 shrink-0 px-1.5 py-0 text-[10px] leading-none">{t("resources.disabled")}</Badge>}
            {item.effective === false && <Badge variant="outline" className="h-4 shrink-0 px-1.5 py-0 text-[10px] leading-none">{t("resources.overridden")}</Badge>}
          </Button>
        </TooltipHint>
      </div>
    )))
  const rail = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b p-4">
        <ResourceListHeader kind={kind} query={search} onQueryChange={setSearch} loading={list.loading} onRefresh={refresh} onCreate={() => setCreating(true)} />
      </div>
      <div className="@container min-h-0 flex-1 overflow-y-auto p-2" data-file-tree-scroll aria-label={t("resources.sources")}>
        {list.loading ? <ResourceLoading /> : list.error ? <ResourceErrorState message={list.error} retry={refresh} /> : groups.length === 0 ? <ResourceEmpty compact text={t(search ? "resources.noMatches" : "resources.empty")} /> : <>
          {sections.global.length > 0 && <ResourceSection title={t(kind === "skills" ? "resources.globalSkills" : "resources.globalMcp")} defaultOpen>{renderItems(sections.global)}</ResourceSection>}
          {sections.projects.map((project) => <ResourceSection key={project.cwd} title={project.name} prefix={t("resources.project")} path={project.cwd}>
            {renderItems(project.groups)}
          </ResourceSection>)}
        </>}
      </div>
      {(list.data?.diagnostics.length ?? 0) > 0 && <details className="max-h-44 overflow-auto border-t p-4 text-xs text-muted-foreground"><summary className="cursor-pointer">{t("resources.diagnostics")} ({list.data?.diagnostics.length})</summary>{list.data?.diagnostics.map((entry, index) => <p key={`${entry.path}:${index}`} className="mt-2 break-words"><span className="font-medium">{entry.path}</span><br />{entry.message}</p>)}</details>}
    </div>
  )
  const pane = (
    <div className="flex h-full min-h-0 flex-col">
      {mobile && selected && <Button className="m-2 w-fit" variant="ghost" size="sm" onClick={() => setSelected(null)}><ArrowLeftIcon />{t("resources.back")}</Button>}
      {detail.loading ? <ResourceLoading /> : detail.error ? <ResourceErrorState message={detail.error} retry={refresh} /> : !detail.data ? <ResourceEmpty text={t("resources.select")} /> : null}
      <React.Suspense fallback={<ResourceLoading />}>
        {recentDetails.map((entry) => {
          const cached = detailScope.cache.get(`${kind}/${entry.id}`)?.state.data
          return cached && <React.Activity key={`${entry.id}:${revision}`} mode={selected === entry.id ? "visible" : "hidden"}>
            <CachedResourceDetailPane kind={kind} detail={cached} query={query} file={entry.file} onChanged={changed} onSkillUpdated={onSkillUpdated} />
          </React.Activity>
        })}
      </React.Suspense>
    </div>
  )
  return (
    <section className="flex min-h-0 flex-1 overflow-hidden border-t">
      {mobile ? <div className="min-h-0 w-full">{selected ? pane : rail}</div> : <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel defaultSize="33.333%" minSize="25%" maxSize="60%">{rail}</ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize="66.667%" minSize="30%">{pane}</ResizablePanel>
      </ResizablePanelGroup>}
      {creating && <React.Suspense fallback={null}><ResourceCreateDialog kind={kind} query={query} groups={list.data?.groups ?? []} open={creating} onOpenChange={setCreating} onSaved={changed} /></React.Suspense>}
    </section>
  )
}

function ResourceSection({ title, prefix, path, children, defaultOpen = false }: {
  title: string; prefix?: string; path?: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const id = React.useId()
  const [open, setOpen] = React.useState(defaultOpen)
  const [visited, setVisited] = React.useState(defaultOpen)
  const [keyboard, setKeyboard] = React.useState(false)
  const heading = <>
    <span className="flex min-w-0 items-center gap-1">
      {prefix && <><span className="shrink-0">{prefix}</span><span aria-hidden className="size-0.75 shrink-0 rounded-full bg-current" /></>}
      <span className="truncate">{title}</span>
    </span>
    <ChevronRightIcon aria-hidden className={cn("size-3.5 shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none", keyboard && "transition-none", open && "rotate-90")} />
    <Separator className="min-w-0 flex-1 data-horizontal:w-auto" aria-hidden />
  </>
  const label = prefix ? `${prefix} ${title}` : title
  return <section aria-labelledby={id} className="mb-5">
    <Collapsible open={open} onOpenChange={(next) => { setOpen(next); if (next) setVisited(true) }}>
      <h2 id={id}>
        <TooltipHint content={path}>
          <CollapsibleTrigger onKeyDown={() => setKeyboard(true)} onPointerDown={() => setKeyboard(false)} className="ring-inset flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={label}>
            {heading}
          </CollapsibleTrigger>
        </TooltipHint>
      </h2>
      <CollapsibleContent keepMounted className={cn(collapsePanel, keyboard && "transition-none")}>{visited && <div className="flex flex-col gap-0.5">{children}</div>}</CollapsibleContent>
    </Collapsible>
  </section>
}
