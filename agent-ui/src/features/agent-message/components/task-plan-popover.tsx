import * as React from "react"
import { ChevronDownIcon, ListTodoIcon } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { AgentPlan } from "@/components/elements/agent-plan"
import { buttonVariants } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

import type { AgentThreadMessage } from "../agent-message-data"
import { foldThreadTaskPlan, type TaskPlan } from "../task-plan"

export function TaskPlanPopover({
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
          key="task-plan-popover"
          initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={shouldReduceMotion ? undefined : { opacity: 0, y: 6 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
          className="pointer-events-auto w-fit"
        >
          <TaskPlanPopoverCard plan={plan} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function TaskPlanPopoverCard({ plan }: { plan: TaskPlan }) {
  const { t } = useTranslation()
  const running = plan.tasks.some((task) => task.status === "in_progress")
  const [open, setOpen] = React.useState(false)
  const ignoreOpenRef = React.useRef(false)
  const progress = t("agentMessage.taskPlanProgress", {
    completed: plan.completedCount,
    total: plan.tasks.length,
  })
  const title = t("agentMessage.taskPlan")

  const handleOpenChange = React.useCallback((next: boolean) => {
    if (next && ignoreOpenRef.current) {
      return
    }
    if (!next) {
      ignoreOpenRef.current = true
      window.setTimeout(() => {
        ignoreOpenRef.current = false
      }, 300)
    }
    setOpen(next)
  }, [])

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "rounded-full bg-background shadow-none dark:bg-background dark:hover:bg-muted dark:aria-expanded:bg-muted"
            )}
            aria-label={`${title}, ${progress}`}
          />
        }
      >
        <ListTodoIcon className="size-3.5 text-muted-foreground" />
        <span className={cn(running && "shimmer motion-reduce:animate-none")}>
          {title}
        </span>
        <span className="text-xs font-medium tabular-nums">{progress}</span>
        <ChevronDownIcon
          className={cn(
            "size-3.5 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
            open && "rotate-180"
          )}
        />
      </PopoverTrigger>
      <PopoverContent
        align="center"
        side="top"
        sideOffset={8}
        className="w-80 gap-3 p-3 shadow-none motion-reduce:animate-none motion-reduce:transition-none data-closed:zoom-out-100"
      >
        <PopoverHeader className="flex-row items-center justify-between gap-2">
          <PopoverTitle>{title}</PopoverTitle>
          <span className="text-xs tabular-nums">{progress}</span>
        </PopoverHeader>
        <AgentPlan
          hideHeader
          title={title}
          steps={plan.steps}
          activeIndex={plan.activeIndex}
          className="max-w-none"
        />
      </PopoverContent>
    </Popover>
  )
}
