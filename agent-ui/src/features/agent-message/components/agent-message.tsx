import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "motion/react"
import { useTranslation } from "react-i18next"

import { useChatSession } from "@/features/chat-session"
import { cn } from "@/lib/utils"

import type { AgentThreadMessage } from "../agent-message-data"
import {
  AgentMessageComposer,
  composerDockTransition,
} from "./agent-message-composer"
import { AgentMessageEmptyState } from "./agent-message-empty-state"
import { AgentMessageThread } from "./agent-message-thread"
import { SessionCwdBreadcrumb } from "./session-cwd-breadcrumb"

const fadeTransition = {
  duration: 0.2,
  ease: "easeOut",
} as const

const agentColumnClassName = "mx-auto w-full max-w-3xl"

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
  const { activeSession } = useChatSession()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const isEmpty = messages.length === 0 && activeSession === null
  const dockTransition = shouldReduceMotion
    ? { duration: 0 }
    : composerDockTransition
  const overlayTransition = shouldReduceMotion
    ? { duration: 0 }
    : fadeTransition

  return (
    <section
      aria-label={t("agentMessage.contentLabel")}
      className="@container/agent-message flex min-h-0 flex-1 flex-col overflow-hidden p-4 pt-0"
    >
      <div className="relative min-h-0 flex-1">
        <AnimatePresence initial={false}>
          {isEmpty ? (
            <motion.div
              key="agent-message-empty"
              className="absolute inset-0 flex flex-col"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={overlayTransition}
            >
              <div className="min-h-0 flex-1" />
              <div className="shrink-0 pb-6">
                <AgentMessageEmptyState />
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="agent-message-thread"
              className="absolute inset-0 min-h-0 overflow-hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={overlayTransition}
            >
              <AgentMessageThread messages={messages} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div
        className={cn(
          "shrink-0",
          agentColumnClassName,
          !isEmpty && "pt-3"
        )}
      >
        <AgentMessageComposer
          compact={!isEmpty}
          draft={draft}
          canSubmit={canSubmit}
          modelReady={modelReady}
          onDraftChange={onDraftChange}
          onModelReferenceChange={onModelReferenceChange}
          onSubmit={onSubmit}
        />
        {activeSession?.cwd ? (
          <SessionCwdBreadcrumb
            key={activeSession.sessionId}
            cwd={activeSession.cwd}
            className="mt-2"
          />
        ) : null}
      </div>

      <motion.div
        aria-hidden="true"
        initial={false}
        animate={{ flexGrow: isEmpty ? 1 : 0 }}
        transition={dockTransition}
        className="min-h-0 basis-0"
      />
    </section>
  )
}
