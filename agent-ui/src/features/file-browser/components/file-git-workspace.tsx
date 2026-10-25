import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { cn } from "@/lib/utils"

/** Keep both panes mounted when the container becomes a single-column browser. */
export function FileGitWorkspace({ tree, preview, narrow, showPreview, compact }: {
  tree: ReactNode
  preview: ReactNode
  narrow: boolean
  showPreview: boolean
  compact: boolean
}) {
  const { t } = useTranslation()
  return <section aria-label="Git" data-git-workspace data-narrow={narrow}
    className={cn("flex min-h-0 min-w-0 flex-1 overflow-hidden border bg-card", compact ? "rounded-lg" : "rounded-xl")}>
    <ResizablePanelGroup orientation="horizontal" className="[&>[data-git-hidden=true]]:hidden! [&>[data-git-full=true]]:flex-1!">
      <ResizablePanel id="git-tree" defaultSize="32%" minSize={narrow ? 0 : 220}
        data-git-hidden={narrow && showPreview} data-git-full={narrow && !showPreview}
        className="flex! min-h-0! min-w-0! flex-col overflow-hidden!">
        <div className="flex min-h-0 flex-1 flex-col" inert={narrow && showPreview} aria-hidden={narrow && showPreview}>
          {tree}
        </div>
      </ResizablePanel>
      <ResizableHandle aria-label={t("fileBrowser.resizePanels")} disabled={narrow} className={narrow ? "hidden" : undefined} />
      <ResizablePanel id="git-preview" minSize={narrow ? 0 : 280}
        data-git-hidden={narrow && !showPreview} data-git-full={narrow && showPreview}
        className="flex! min-h-0! min-w-0! overflow-hidden!">
        <div className="flex min-h-0 min-w-0 flex-1" inert={narrow && !showPreview} aria-hidden={narrow && !showPreview}>
          {preview}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  </section>
}
