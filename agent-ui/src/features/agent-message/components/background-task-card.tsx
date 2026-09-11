import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"
import { SquareIcon, FileTextIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useChatSession } from "@/features/chat-session"
import { useHarness } from "@/features/sidebar/header/harness-context"
import { useOptionalWorkspaceFiles } from "@/features/workspace/workspace-files-context"
import { useWorkspaceWorkflow } from "@/features/workspace/use-workspace-workflow"
import { stopBackgroundTask, taskIsActive, type BackgroundTask } from "../background-task-store"

export function BackgroundTaskCard({ task }: { task: BackgroundTask }) {
  const { runSessionId } = useChatSession()
  const { runHarnessId } = useHarness()
  const files = useOptionalWorkspaceFiles()
  const { openTask } = useWorkspaceWorkflow()
  return <BackgroundTaskStatus task={task}
    onStop={() => stopBackgroundTask(`${runHarnessId}:${runSessionId}`, task.taskId)}
    onOpenOutput={() => {
      if (task.kind === "agent") openTask(task)
      else if (task.outputFile) files?.openFileInWorkspace(task.outputFile, { previewMode: "source" })
    }} />
}

export function BackgroundTaskStopButton({ task }: { task: BackgroundTask }) {
  const { t } = useTranslation()
  const { runSessionId } = useChatSession()
  const { runHarnessId } = useHarness()
  if (!taskIsActive(task)) return null
  return <Button type="button" variant="ghost" size="icon-sm" disabled={task.stopRequested}
    onClick={() => stopBackgroundTask(`${runHarnessId}:${runSessionId}`, task.taskId)}
    aria-label={t("backgroundTasks.stopTask", { name: task.description ?? task.taskId })}>
    <SquareIcon className="size-3" aria-hidden="true" />
  </Button>
}

export function BackgroundTaskStatus({ task, onStop, onOpenOutput }: {
  task: BackgroundTask; onStop?: () => void; onOpenOutput?: () => void
}) {
  const { t } = useTranslation()
  const reduced = useReducedMotion()
  const active = taskIsActive(task)
  return (
    <div data-background-task={task.taskId} className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border/60 px-3 py-2 text-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{task.description ?? task.kind}</span>
        <motion.span key={task.status} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : 0.15 }} role="status">
          <Badge variant={task.status === "failed" ? "destructive" : "secondary"}>{t(`backgroundTasks.status.${task.status}`)}</Badge>
        </motion.span>
        {active && onStop ? <Button type="button" variant="ghost" size="sm" disabled={task.stopRequested} onClick={onStop} aria-label={t("backgroundTasks.stopTask", { name: task.description ?? task.taskId })}>
          <SquareIcon className="size-3" aria-hidden="true" />{t(task.stopRequested ? "backgroundTasks.stopping" : "backgroundTasks.stop")}
        </Button> : null}
      </div>
      {task.summary ? <p className="m-0 break-words text-xs leading-5 text-muted-foreground">{task.summary}</p> : null}
      {(task.outputFile || task.kind === "agent") && onOpenOutput ? <Button type="button" variant="ghost" size="sm" className="h-7 w-fit max-w-full px-0 text-xs" onClick={onOpenOutput}>
        <FileTextIcon className="size-3.5" aria-hidden="true" />{t("backgroundTasks.output")}
      </Button> : null}
    </div>
  )
}
