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
  toTodoItemStatus,
  type TaskPlan,
} from "../task-plan"

const STATUS_COPY: Record<
  TodoItemStatus,
  "pending" | "inProgress" | "completed" | "cancelled"
> = {
  pending: "pending",
  "in-progress": "inProgress",
  completed: "completed",
  cancelled: "cancelled",
}

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
            title={t("agentMessage.todoList")}
            items={toTodoItems(plan, (status) =>
              t(`agentMessage.todoStatus.${STATUS_COPY[status]}`)
            )}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function toTodoItems(
  plan: TaskPlan,
  statusText: (status: TodoItemStatus) => string
): TodoItem[] {
  return plan.tasks.map((task) => {
    const status = toTodoItemStatus(task.status)
    return {
      id: task.id,
      title: task.subject,
      status,
      detail: statusText(status),
    }
  })
}
