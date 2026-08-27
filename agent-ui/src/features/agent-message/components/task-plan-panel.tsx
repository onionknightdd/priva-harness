import * as React from "react"
import { ChevronDownIcon, ListTodoIcon } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { AgentPlan } from "@/components/elements/agent-plan"
import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

import type { AgentThreadMessage } from "../agent-message-data"
import { foldThreadTaskPlan, type TaskPlan } from "../task-plan"

const PANEL_CLASS =
  "h-[var(--collapsible-panel-height)] overflow-hidden transition-[height,opacity] duration-200 ease-out data-[ending-style]:h-0 data-[ending-style]:opacity-0 data-[starting-style]:h-0 data-[starting-style]:opacity-0 motion-reduce:transition-none"

export function TaskPlanPanel({
  messages,
}: {
  messages: readonly AgentThreadMessage[]
}) {
  const plan = foldThreadTaskPlan(messages)
  const shouldReduceMotion = Boolean(useReducedMotion())

  return (
    <AnimatePresence initial={false}>
      {plan ? (
        <motion.div
          key="task-plan-panel"
          initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={shouldReduceMotion ? undefined : { opacity: 0, y: 8 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
          className="mb-2"
        >
          <TaskPlanPanelCard plan={plan} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function TaskPlanPanelCard({ plan }: { plan: TaskPlan }) {
  const { t } = useTranslation()
  const running = plan.tasks.some((task) => task.status === "in_progress")
  const [open, setOpen] = React.useState(running)

  React.useEffect(() => {
    if (running) {
      setOpen(true)
    }
  }, [running])

  return (
    <Collapsible
      className="group/task-plan overflow-hidden rounded-3xl border border-input shadow-xs dark:bg-input/30"
      open={open}
      onOpenChange={setOpen}
    >
      <CollapsibleTrigger
        className={cn(
          "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm font-medium outline-none",
          "hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50",
          "motion-reduce:transition-none"
        )}
      >
        <ListTodoIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">
          {t("agentMessage.taskPlan")}
        </span>
        <Badge variant={running ? "secondary" : "outline"}>
          {t("agentMessage.taskPlanProgress", {
            completed: plan.completedCount,
            total: plan.tasks.length,
          })}
        </Badge>
        <ChevronDownIcon
          className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-open/task-plan:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className={PANEL_CLASS}>
        <AgentPlan
          hideHeader
          title={t("agentMessage.taskPlan")}
          steps={plan.steps}
          activeIndex={plan.activeIndex}
          className="max-w-none px-3 pt-1 pb-3"
        />
      </CollapsibleContent>
    </Collapsible>
  )
}
