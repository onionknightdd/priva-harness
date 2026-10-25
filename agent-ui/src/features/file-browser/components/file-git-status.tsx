import { createContext, useContext, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { TooltipHint } from "@/components/ui/tooltip"
import type { GitDecoration } from "@/features/git/git-data"
import { gitStatusClass } from "@/features/git/git-status-style"
import { cn } from "@/lib/utils"

const GitDecorationsContext = createContext<ReadonlyMap<string, GitDecoration> | null>(null)

export function FileGitStatusProvider({ decorations, children }: {
  decorations: ReadonlyMap<string, GitDecoration>
  children: ReactNode
}) {
  return <GitDecorationsContext value={decorations}>{children}</GitDecorationsContext>
}

export function FileGitStatus({ path }: { path: string }) {
  const decorations = useContext(GitDecorationsContext)
  const { i18n } = useTranslation()
  if (!decorations) return null
  const decoration = decorations.get(path)
  const zh = i18n.language.startsWith("zh")
  const labels: Record<string, string> = zh
    ? { M: "已修改", A: "已添加", D: "已删除", R: "已重命名", C: "已复制", U: "存在冲突", "?": "未跟踪", ".": "包含改动" }
    : { M: "Modified", A: "Added", D: "Deleted", R: "Renamed", C: "Copied", U: "Conflicted", "?": "Untracked", ".": "Contains changes" }
  const status = decoration?.conflicted ? "U" : decoration?.status
  return <TooltipHint content={status ? `Git · ${labels[status] ?? status}` : undefined}>
    <span data-git-status={status} aria-label={status ? `Git: ${labels[status] ?? status}` : undefined}
      className={cn("inline-flex w-4 shrink-0 items-center justify-center font-mono text-xs font-semibold", status && gitStatusClass(status))}>
      {decoration?.kind === "directory" ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" /> : status}
    </span>
  </TooltipHint>
}
