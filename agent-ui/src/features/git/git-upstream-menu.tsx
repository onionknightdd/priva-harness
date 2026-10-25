import { useState } from "react"
import { Check, ChevronDown, GitBranch, RefreshCw, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { GitIconButton, GitNotice } from "./git-ui-primitives"
import { useGitText } from "./git-ui-text"
import type { GitRepositoryController } from "./use-git-repository"

export function GitUpstreamMenu({ controller }: { controller: GitRepositoryController }) {
  const t = useGitText()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const { repository, busy, perform, actionError } = controller
  if (!repository) return null
  const currentName = repository.upstream ?? t.noUpstream
  const remoteBranches = repository.branches.filter((branch) => branch.remote)
  const branches = remoteBranches.filter((branch) => branch.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const canSetUpstream = Boolean(repository.branch && repository.commit)

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button variant="ghost" size="xs" className="h-6 min-w-0 flex-1 shrink justify-start gap-1 px-1 text-xs text-muted-foreground" aria-label={`${t.selectUpstream}: ${currentName}`} title={currentName} />}>
      <span className="min-w-0 truncate font-mono">{currentName}</span><ChevronDown aria-hidden="true" className="size-3 shrink-0" />
    </PopoverTrigger>
    <PopoverContent align="start" className="max-h-[min(70vh,480px)] w-72 max-w-[calc(100vw-2rem)] gap-1 p-1">
      <div className="m-1 flex items-center gap-1">
        <div className="relative min-w-0 flex-1"><Search aria-hidden="true" className="absolute top-2 left-2 size-4 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} aria-label={t.searchRemoteBranches} placeholder={t.searchRemoteBranches} className="h-8 pl-8 text-xs" /></div>
        <GitIconButton label={repository.remotes.length ? t.fetch : t.noRemote} disabled={Boolean(busy) || !repository.remotes.length} busy={busy === "fetch"} onClick={() => void perform({ action: "fetch" })}><RefreshCw /></GitIconButton>
      </div>
      <div className="min-h-0 overflow-y-auto">
        {branches.map((branch) => {
          const current = branch.name === repository.upstream
          return <Button key={branch.name} variant="ghost" size="sm" disabled={Boolean(busy) || !canSetUpstream || current} onClick={async () => { if (await perform({ action: "set-upstream", branch: branch.name })) setOpen(false) }} className="h-8 w-full justify-start gap-2 px-2 text-xs" title={branch.name}>
            {current ? <Check className="size-4" /> : <GitBranch className="size-4 text-muted-foreground" />}
            <span className="truncate font-mono">{branch.name}</span>
            {current && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{t.current}</span>}
          </Button>
        })}
        {!branches.length && <GitNotice>{remoteBranches.length ? t.noBranches : t.noRemoteBranches}</GitNotice>}
      </div>
      <p className="px-2 py-1 text-[11px] text-muted-foreground">{canSetUpstream ? t.upstreamDescription : t.upstreamRequiresBranch}</p>
      {actionError && <GitNotice error>{actionError}</GitNotice>}
    </PopoverContent>
  </Popover>
}
