import { lazy, Suspense } from "react"
import { useTranslation } from "react-i18next"
import { useActiveSession } from "@/features/chat-session"
import { useHarness } from "@/features/sidebar/header/harness-context"
import { useWorkspaceWhiteboard, whiteboardScope } from "../workspace-whiteboard-context"
const WhiteboardRenderer = lazy(() => import("@/features/whiteboard/whiteboard-renderer").then(module => ({ default: module.WhiteboardRenderer })))

export function WorkspaceWhiteboardView() {
  const { t } = useTranslation()
  const { runSessionId, runCwd } = useActiveSession()
  const { runHarnessId } = useHarness()
  const boards = useWorkspaceWhiteboard()
  const scope = whiteboardScope(runHarnessId, runSessionId, runCwd)
  const path = boards?.paths[scope]
  return <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden" data-workspace-whiteboard>
    {path ? <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">{t("whiteboard.loading")}</p>}><WhiteboardRenderer path={path} animateInitial={boards?.live[scope]} onContentChange={() => boards?.seen(scope)} /></Suspense>
      : <p className="m-auto p-6 text-center text-sm text-muted-foreground">{t("whiteboard.empty")}</p>}
  </div>
}
