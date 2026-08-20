import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"

import type { AgentThreadMessage } from "../agent-message-data"
import { AgentMessageComposer } from "./agent-message-composer"
import { AgentMessageEmptyState } from "./agent-message-empty-state"
import { AgentMessageThread } from "./agent-message-thread"

const composerTransition = {
  type: "spring",
  stiffness: 420,
  damping: 34,
  mass: 0.75,
} as const

const composerWidthClassName = "w-full max-w-[calc(48rem+40px)]"

export function AgentMessage({
  draft,
  messages,
  canSubmit,
  modelReady,
  onDraftChange,
  onModelReferenceChange,
  onSubmit,
}: {
  draft: string
  messages: AgentThreadMessage[]
  canSubmit: boolean
  modelReady: boolean
  onDraftChange: (draft: string) => void
  onModelReferenceChange: (model: string | null) => void
  onSubmit: () => void
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const isEmpty = messages.length === 0
  const transition = shouldReduceMotion
    ? { duration: 0 }
    : composerTransition

  const composer = (
    <motion.div
      layoutId={shouldReduceMotion ? undefined : "agent-message-composer"}
      className={composerWidthClassName}
      transition={transition}
    >
      <AgentMessageComposer
        draft={draft}
        canSubmit={canSubmit}
        modelReady={modelReady}
        onDraftChange={onDraftChange}
        onModelReferenceChange={onModelReferenceChange}
        onSubmit={onSubmit}
      />
    </motion.div>
  )

  return (
    <section
      aria-label={t("agentMessage.contentLabel")}
      className="flex min-h-0 flex-1 flex-col overflow-hidden p-4 pt-0"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {isEmpty ? (
          <motion.div
            key="agent-message-empty"
            className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6"
            initial={
              shouldReduceMotion ? false : { opacity: 0, y: 8 }
            }
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0 }}
            transition={transition}
          >
            <AgentMessageEmptyState />
            {composer}
          </motion.div>
        ) : (
          <motion.div
            key="agent-message-thread"
            className="flex min-h-0 flex-1 flex-col"
            initial={shouldReduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0 }}
            transition={transition}
          >
            <div className="min-h-0 flex-1">
              <AgentMessageThread messages={messages} />
            </div>
            <div
              className={cn(
                "mx-auto flex justify-center pt-3",
                composerWidthClassName
              )}
            >
              {composer}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
