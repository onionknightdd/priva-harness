import { useTranslation } from "react-i18next"
import { useActiveSession } from "@/features/chat-session"
import { useHarness } from "@/features/sidebar/header/harness-context"
import { useBackgroundTasks } from "@/features/agent-message/background-task-store"
import { BackgroundTaskCard } from "@/features/agent-message/components/background-task-card"

export function WorkspaceTasksView() {
  const { t } = useTranslation()
  const { runSessionId } = useActiveSession()
  const { runHarnessId } = useHarness()
  const tasks = useBackgroundTasks(`${runHarnessId}:${runSessionId}`)
  return <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
    <h2 className="mb-1 text-sm font-medium">{t("backgroundTasks.title")}</h2>
    {tasks.length ? tasks.map((task) => <BackgroundTaskCard key={task.taskId} task={task} />) : <p className="text-sm text-muted-foreground">{t("backgroundTasks.empty")}</p>}
  </div>
}
