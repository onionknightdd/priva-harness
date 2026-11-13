import { lazy, Suspense, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { useActiveSession } from "@/features/chat-session"
import { useHarness } from "@/features/sidebar/header/harness-context"
import { useWhiteboardFiles } from "@/features/whiteboard/use-whiteboard-files"
import { useWorkspaceWhiteboard, whiteboardScope } from "../workspace-whiteboard-context"
const WhiteboardRenderer = lazy(() => import("@/features/whiteboard/whiteboard-renderer").then(module => ({ default: module.WhiteboardRenderer })))

export function WorkspaceWhiteboardView() {
  const { t } = useTranslation()
  const { runSessionId, runCwd } = useActiveSession()
  const { runHarnessId } = useHarness()
  const boards = useWorkspaceWhiteboard()
  const scope = whiteboardScope(runHarnessId, runSessionId, runCwd)
  const path = boards?.paths[scope]
  const listing = useWhiteboardFiles(runCwd, runSessionId, path)
  const firstPath = listing.files[0]?.path
  const open = boards?.open
  useEffect(() => {
    if (!path && firstPath) open?.(scope, firstPath, false, false)
  }, [path, firstPath, scope, open])
  return <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden" data-workspace-whiteboard>
    {path ? <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">{t("whiteboard.loading")}</p>}><WhiteboardRenderer path={path} animateInitial={boards?.live[scope]} onContentChange={(_content, revision) => { boards?.seen(scope); listing.contentArrived(revision) }} filePicker={{ files: listing.files, loading: listing.loading, error: listing.error, onRefresh: () => { void listing.refresh() }, onSelect: next => open?.(scope, next, false, false) }} /></Suspense>
      : <div className="m-auto flex flex-col items-center gap-3 p-6 text-center text-sm text-muted-foreground">
        <p role={listing.error ? "alert" : undefined}>{listing.error ?? t(listing.loading ? "whiteboard.loading" : "whiteboard.empty")}</p>
        {runSessionId && !listing.loading && <Button variant="outline" size="sm" onClick={() => { void listing.refresh() }}>{t("whiteboard.retry")}</Button>}
      </div>}
  </div>
}
