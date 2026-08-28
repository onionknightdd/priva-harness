import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import {
  TodoList,
  type TodoItem,
  type TodoItemStatus,
} from "@/components/agents/todo-list"

import type { AgentThreadMessage } from "../agent-message-data"
import {
  foldThreadTaskPlan,
  type TaskBoardStatus,
  type TaskPlan,
} from "../task-plan"

export function TaskPlanDock({
  messages,
}: {
  messages: readonly AgentThreadMessage[]
}) {
  const { t } = useTranslation()
  const plan = foldThreadTaskPlan(messages)
  const shouldReduceMotion = Boolean(useReducedMotion())

  return (
    <AnimatePresence initial={false}>
      {plan ? (
        <motion.div
          key="task-plan-dock"
          initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={shouldReduceMotion ? undefined : { opacity: 0, y: 6 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
          className="mb-2 w-full"
        >
          <TodoList
            title={t("agentMessage.taskPlan")}
            items={toTodoItems(plan)}
            className="rounded-3xl border-input bg-background shadow-xs dark:bg-input/30"
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function toTodoItems(plan: TaskPlan): TodoItem[] {
  return plan.tasks.map((task) => ({
    id: task.id,
    title:
      task.status === "in_progress" && task.activeForm
        ? task.activeForm
        : task.subject,
    status: toTodoStatus(task.status),
    detail: task.owner,
  }))
}

function toTodoStatus(status: TaskBoardStatus): TodoItemStatus {
  return status === "in_progress" ? "in-progress" : status
}
