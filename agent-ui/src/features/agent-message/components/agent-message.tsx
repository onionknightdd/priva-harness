import { useEffect, useRef } from "react"
import type { InteractionRequest, InteractionResponse } from '../interaction-data'
import { InteractionCard } from './interaction-card'
import type { ComposerAttachment } from "../composer-attachments"
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
import type { ContextUsage } from "../context-usage"
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
import { ComposerContextRing } from "./composer-context-ring"
import { SessionCwdIndicator } from "./session-cwd-indicator"

const fadeTransition = {
  duration: 0.2,
  ease: "easeOut",
} as const

const agentColumnClassName = "mx-auto w-full max-w-3xl"

export function AgentMessage({
  interactions = [],
  interactionConnected = false,
  onInteractionResponse,
  attachments,
  onFilesSelected,
  onAttachmentRemove,
  onAttachmentRetry,
  draft,
  messages,
  contextUsage,
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
  interactions?: InteractionRequest[]
  interactionConnected?: boolean
  onInteractionResponse?: (response: InteractionResponse) => Promise<void>
  attachments: ComposerAttachment[]
  onFilesSelected: (files: File[]) => void
  onAttachmentRemove: (id: string) => void
  onAttachmentRetry: (id: string) => void
  draft: string
  messages: AgentThreadMessage[]
  contextUsage: ContextUsage
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
  const composerShellRef = useRef<HTMLDivElement>(null)
  const { activeSession, forkError, runCwd, runSessionId, setDraftCwd } = useChatSession()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const pending = interactions[0]
  const hadInteraction = useRef(false)
  useEffect(() => {
    if (hadInteraction.current && !pending) {
      const id = requestAnimationFrame(focusAgentComposer)
      hadInteraction.current = false
      return () => cancelAnimationFrame(id)
    }
    hadInteraction.current = Boolean(pending)
  }, [pending])
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
      className="@container/agent-message flex min-h-0 flex-1 flex-col overflow-hidden pt-0 pr-2 pb-4 pl-4"
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
      </div>

      <div
        className={cn(
          "shrink-0",
          agentColumnClassName,
          !isEmpty && "pt-1.5"
        )}
      >
        {pending && onInteractionResponse ? (
          <motion.div key={pending.requestId} ref={composerShellRef}
            initial={shouldReduceMotion ? false : { opacity: 0, transform: 'translateY(4px)' }}
            animate={{ opacity: 1, transform: 'translateY(0px)' }} transition={{ duration: shouldReduceMotion ? 0 : 0.15 }}>
            <InteractionCard request={pending} count={interactions.length} connected={interactionConnected} onRespond={onInteractionResponse} />
          </motion.div>
        ) : <AgentMessageComposer
          attachments={attachments}
          onFilesSelected={onFilesSelected}
          onAttachmentRemove={onAttachmentRemove}
          onAttachmentRetry={onAttachmentRetry}
          compact={!isEmpty}
          draft={draft}
          canSubmit={canSubmit}
          isStreaming={isStreaming}
          modelReady={modelReady}
          slashCommand={slashCommand}
          shellRef={composerShellRef}
          onDraftChange={onDraftChange}
          onSlashCommandChange={onSlashCommandChange}
          onModelReferenceChange={onModelReferenceChange}
          onEffortChange={onEffortChange}
          onSubmit={onSubmit}
          onStop={onStop}
        />}
        <div className="mt-1 flex items-center gap-1.5">
          {runCwd ? (
            <SessionCwdIndicator
              cwd={runCwd}
              onChange={isEmpty && !isStreaming && !runSessionId ? setDraftCwd : undefined}
              className="min-w-0"
            />
          ) : null}
          <AnimatePresence initial={false}>
            {isEmpty ? null : (
              <motion.div
                key="composer-context-ring"
                className="ml-auto flex items-center pr-2.5"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={overlayTransition}
              >
                <ComposerContextRing
                  usage={contextUsage}
                  anchorRef={composerShellRef}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
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
