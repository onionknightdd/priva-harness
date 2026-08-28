import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "motion/react"
import { useTranslation } from "react-i18next"

import { useChatSession } from "@/features/chat-session"
import type { SlashCommand } from "@/lib/api/slash-commands"
import { cn } from "@/lib/utils"

import type { AgentThreadMessage } from "../agent-message-data"
import {
  appendQuotedDraft,
  focusAgentComposer,
} from "../quote-selection"
import {
  AgentMessageComposer,
  composerDockTransition,
} from "./agent-message-composer"
import { AgentMessageEmptyState } from "./agent-message-empty-state"
import { AgentMessageThread } from "./agent-message-thread"
import type { ComposerEffort } from "./composer-model-selector"
import { SessionCwdIndicator } from "./session-cwd-indicator"
import { TaskPlanPopover } from "./task-plan-popover"

const fadeTransition = {
  duration: 0.2,
  ease: "easeOut",
} as const

const agentColumnClassName = "mx-auto w-full max-w-3xl"

export function AgentMessage({
  draft,
  messages,
  canSubmit,
  isStreaming,
  modelReady,
  slashCommand,
  onDraftChange,
  onSlashCommandChange,
  onModelReferenceChange,
  onEffortChange,
  onSubmit,
  onStop,
}: {
  draft: string
  messages: AgentThreadMessage[]
  canSubmit: boolean
  isStreaming: boolean
  modelReady: boolean
  slashCommand: SlashCommand | null
  onDraftChange: (draft: string) => void
  onSlashCommandChange: (command: SlashCommand | null) => void
  onModelReferenceChange: (model: string | null) => void
  onEffortChange: (effort: ComposerEffort) => void
  onSubmit: () => void
  onStop: () => void
}) {
  const { t } = useTranslation()
  const { activeSession, forkError, runCwd } = useChatSession()
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
              <AgentMessageThread
                messages={messages}
                onQuote={(text) => {
                  onDraftChange(appendQuotedDraft(draft, text))
                  requestAnimationFrame(() => {
                    focusAgentComposer()
                  })
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20">
          <div className="mx-auto w-full max-w-3xl">
            <TaskPlanPopover messages={messages} />
          </div>
        </div>
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
          isStreaming={isStreaming}
          modelReady={modelReady}
          slashCommand={slashCommand}
          onDraftChange={onDraftChange}
          onSlashCommandChange={onSlashCommandChange}
          onModelReferenceChange={onModelReferenceChange}
          onEffortChange={onEffortChange}
          onSubmit={onSubmit}
          onStop={onStop}
        />
        {runCwd ? (
          <SessionCwdIndicator
            key={runCwd}
            cwd={runCwd}
            className="mt-2"
          />
        ) : null}
        {forkError ? (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {forkError === "needs_transcript"
              ? t("agentMessage.forkNeedsTranscript")
              : forkError === "failed"
                ? t("agentMessage.forkFailed")
                : forkError}
          </p>
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
