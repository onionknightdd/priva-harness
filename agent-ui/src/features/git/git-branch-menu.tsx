import { useState } from "react"
import { Check, ChevronDown, GitBranch, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useGitText } from "./git-ui-text"
import { GitNotice } from "./git-ui-primitives"
import type { GitRepositoryController } from "./use-git-repository"

export function GitBranchMenu({ controller }: { controller: GitRepositoryController }) {
  const t = useGitText()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const { repository, busy, perform, actionError } = controller
  if (!repository) return null
  const branches = repository.branches.filter((branch) => !branch.remote && branch.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const currentName = repository.branch ?? `${t.detached}${repository.commit ? ` · ${repository.commit.slice(0, 7)}` : ""}`
  const switchBranch = async (branch: string) => {
    if (await perform({ action: "switch", branch })) setOpen(false)
  }

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button variant="ghost" size="xs" className="h-6 min-w-0 max-w-[50%] shrink justify-start gap-1 px-1 text-xs" aria-label={`${t.branches}: ${currentName}`} title={currentName} />}>
      <span className="min-w-0 truncate font-mono">{currentName}</span><ChevronDown aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
    </PopoverTrigger>
    <PopoverContent align="start" className="max-h-[min(70vh,480px)] w-72 max-w-[calc(100vw-2rem)] gap-1 p-1">
      <div className="relative m-1"><Search aria-hidden="true" className="absolute top-2 left-2 size-4 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} aria-label={t.searchBranches} placeholder={t.searchBranches} className="h-8 pl-8 text-xs" /></div>
      <div className="min-h-0 overflow-y-auto">
        {branches.map((branch) => <Button key={branch.name} variant="ghost" size="sm" disabled={Boolean(busy) || branch.current} onClick={() => void switchBranch(branch.name)} className="h-8 w-full justify-start gap-2 px-2 text-xs" title={branch.name}>
          {branch.current ? <Check className="size-4" /> : <GitBranch className="size-4 text-muted-foreground" />}
          <span className="truncate font-mono">{branch.name}</span>
          {branch.current && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{t.current}</span>}
        </Button>)}
        {!branches.length && <GitNotice>{t.noBranches}</GitNotice>}
      </div>
      {actionError && <GitNotice error>{actionError}</GitNotice>}
    </PopoverContent>
  </Popover>
}
