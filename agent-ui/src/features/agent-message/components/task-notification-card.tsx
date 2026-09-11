import { BotIcon, SquareArrowOutUpRightIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useWorkspaceWorkflow } from "@/features/workspace/use-workspace-workflow"
import { useOptionalWorkspaceFiles } from "@/features/workspace/workspace-files-context"
import type { TaskNotification } from "../background-task-store"

export function TaskNotificationCard({ notification }: { notification: TaskNotification }) {
  const { openTask } = useWorkspaceWorkflow()
  const files = useOptionalWorkspaceFiles()
  const { task } = notification
  return <TaskNotificationStatus notification={notification} onOpen={() => {
    if (task.kind === "agent") openTask(task, notification.id)
    else if (task.outputFile) files?.openFileInWorkspace(task.outputFile, { previewMode: "source" })
    else openTask(task, notification.id)
  }} />
}

export function TaskNotificationStatus({ notification, onOpen }: { notification: TaskNotification; onOpen: () => void }) {
  const { t } = useTranslation()
  const reduced = useReducedMotion()
  const { task } = notification
  const label = task.description ?? task.summary ?? task.taskId
  return <motion.div data-task-notification={notification.id} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
    <Button variant="outline" onClick={onOpen}
      aria-label={t("agentMessage.workflowUI.openAgent", { agent: label })}
      className="h-auto w-full min-w-0 justify-start gap-2 whitespace-normal px-3 py-2 text-left">
      <BotIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 break-words text-sm text-muted-foreground">{label}</span>
      <Badge variant={task.status === "failed" ? "destructive" : "secondary"}>{t(`backgroundTasks.status.${task.status}`)}</Badge>
      <SquareArrowOutUpRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Button>
  </motion.div>
}
