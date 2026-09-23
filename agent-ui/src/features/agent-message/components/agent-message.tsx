import { useCallback, useEffect, useLayoutEffect, useRef } from "react"
import type { InteractionRequest, InteractionResponse } from '../interaction-data'
import { InteractionCard } from './interaction-card'
import type { ComposerAttachment } from "../composer-attachments"
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "motion/react"
import { useTranslation } from "react-i18next"

import { useActiveSession, useChatSessionActions } from "@/features/chat-session"
import type { SlashCommand } from "@/lib/api/slash-commands"
import { cn } from "@/lib/utils"

import type { AgentThreadMessage } from "../agent-message-data"
import { AGENT_CHAT_HEADER_HEIGHT } from "../agent-chat-layout"
import type { ContextUsage } from "../context-usage"
import { appendQuotedDraft } from "../quote-selection"
import { serializeMessageSelections } from "../message-select-action"
import type { OnQuoteInChat } from "../selection-actions-context"
import type { ComposerEditorHandle } from "./composer-editor"
import {
  AgentMessageComposer,
  composerDockTransition,
} from "./agent-message-composer"
import { AgentMessageEmptyState } from "./agent-message-empty-state"
import { AgentMessageThread } from "./agent-message-thread"
import type { ComposerEffort } from "./composer-model-selector"
import { ComposerContextRing } from "./composer-context-ring"
import { SessionCwdIndicator } from "./session-cwd-indicator"
import { SessionGitIndicator } from "./session-git-indicator"

const fadeTransition = {
  duration: 0.2,
  ease: "easeOut",
} as const

const agentColumnClassName = "mx-auto w-full max-w-3xl"

export function AgentMessage({
  hidden = false,
  interactions = [],
  interactionConnected = false,
  onInteractionResponse,
  attachments,
  onFilesSelected,
  onAttachmentRemove,
  onAttachmentRetry,
  draft,
  promptSuggestion,
  onDismissPromptSuggestion,
  messages,
  contextUsage,
  canSubmit,
  isStreaming,
  modelReady,
  modelReference,
  effort,
  slashCommand,
  onDraftChange,
  onSlashCommandChange,
  onModelReferenceChange,
  onEffortChange,
  onSubmit,
  onStop,
}: {
  /** Collapsed while the terminal view owns the screen; state and the socket stay alive. */
  hidden?: boolean
  interactions?: InteractionRequest[]
  interactionConnected?: boolean
  onInteractionResponse?: (response: InteractionResponse) => Promise<void>
  attachments: ComposerAttachment[]
  onFilesSelected: (files: File[]) => void
  onAttachmentRemove: (id: string) => void
  onAttachmentRetry: (id: string) => void
  draft: string
  promptSuggestion?: string
  onDismissPromptSuggestion?: () => void
  messages: AgentThreadMessage[]
  contextUsage: ContextUsage
  canSubmit: boolean
  isStreaming: boolean
  modelReady: boolean
  modelReference: string | null
  effort: ComposerEffort
  slashCommand: SlashCommand | null
  onDraftChange: (draft: string) => void
  onSlashCommandChange: (command: SlashCommand | null) => void
  onModelReferenceChange: (model: string | null) => void
  onEffortChange: (effort: ComposerEffort) => void
  onSubmit: () => void
  onStop: () => void
}) {
  const { t } = useTranslation()
  const sectionRef = useRef<HTMLElement>(null)
  const wasHidden = useRef(hidden)
  const composerShellRef = useRef<HTMLDivElement>(null)
  const composerEditorRef = useRef<ComposerEditorHandle>(null)
  const { activeSession, forkError, runCwd, runSessionId } = useActiveSession()
  const { setDraftCwd } = useChatSessionActions()
  const shouldReduceMotion = Boolean(useReducedMotion())
  useLayoutEffect(() => {
    if (wasHidden.current && !hidden) {
      // display:none restarts retained Streamdown CSS animations on reveal.
      // Finish received text before paint; future tokens keep their animations.
      for (const token of sectionRef.current?.querySelectorAll("[data-sd-animate]") ?? []) {
        for (const animation of token.getAnimations()) animation.finish()
      }
    }
    wasHidden.current = hidden
  }, [hidden])
  const pending = interactions[0]
  const hadInteraction = useRef(false)
  useEffect(() => {
    if (hadInteraction.current && !pending) {
      const id = requestAnimationFrame(() => composerEditorRef.current?.focus(true))
      hadInteraction.current = false
      return () => cancelAnimationFrame(id)
    }
    hadInteraction.current = Boolean(pending)
  }, [pending])
  const isEmpty = messages.length === 0 && activeSession === null
  // Every inline file reference subscribes to the selection action, so keep
  // its identity stable while the draft and connection state change.
  const selectionContext = useRef({ draft, onDraftChange })
  useLayoutEffect(() => {
    selectionContext.current = { draft, onDraftChange }
  })
  const onSelectionAction = useCallback<OnQuoteInChat>((quote) => {
    const { draft, onDraftChange } = selectionContext.current
    if (quote.type === "selection" && composerEditorRef.current) {
      composerEditorRef.current.insertSelection(quote.selection)
      return
    }
    onDraftChange(quote.type === "file"
      ? appendQuotedDraft(draft, quote.path)
      : draft + serializeMessageSelections([{ type: "selection", selection: quote.selection }]))
    requestAnimationFrame(() => composerEditorRef.current?.focus(true))
  }, [])
  const dockRef = useRef<HTMLDivElement>(null)
  const dockSpacerRef = useRef<HTMLDivElement>(null)
  const dockTop = useRef<number | null>(null)
  // Remember where the composer column was last painted. ResizeObserver runs
  // after layout, so this never forces a reflow; skip readings taken while a
  // dock animation is transforming the column.
  useEffect(() => {
    const dock = dockRef.current
    const spacer = dockSpacerRef.current
    if (!dock || !spacer) return
    const record = () => {
      if (dock.getAnimations().length === 0) {
        dockTop.current = dock.getBoundingClientRect().top
      }
    }
    record()
    const observer = new ResizeObserver(record)
    observer.observe(dock)
    observer.observe(spacer)
    return () => observer.disconnect()
  }, [])
  // The spacer switches layout instantly; the column slides from its previous
  // position with a compositor-driven transform, so the animation keeps
  // running while the main thread mounts a long transcript.
  useLayoutEffect(() => {
    const dock = dockRef.current
    const previousTop = dockTop.current
    if (!dock || previousTop === null) return
    const nextTop = dock.getBoundingClientRect().top
    dockTop.current = nextTop
    const delta = previousTop - nextTop
    if (shouldReduceMotion || Math.abs(delta) < 1) return
    const animation = dock.animate(
      [{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }],
      {
        duration: composerDockTransition.duration * 1000,
        easing: `cubic-bezier(${composerDockTransition.ease.join(", ")})`,
      }
    )
    return () => animation.cancel()
  }, [isEmpty, shouldReduceMotion])
  const overlayTransition = shouldReduceMotion
    ? { duration: 0 }
    : fadeTransition

  return (
    <section
      ref={sectionRef}
      aria-label={t("agentMessage.contentLabel")}
      className={cn("@container/agent-message flex min-h-0 flex-1 flex-col overflow-hidden pr-2 pb-4 pl-4", hidden && "hidden")}
      style={{ marginTop: -AGENT_CHAT_HEADER_HEIGHT, paddingTop: AGENT_CHAT_HEADER_HEIGHT }}
    >
      <div className="relative min-h-0 flex-1">
        {/* Both children are absolutely positioned, so presence never shifts
            siblings; the default would hand every motion element in the
            thread a fresh presence context on each render here. */}
        <AnimatePresence initial={false} presenceAffectsLayout={false}>
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
              className="absolute -right-2 bottom-0 -left-4 min-h-0 overflow-hidden"
              style={{ top: -AGENT_CHAT_HEADER_HEIGHT }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={overlayTransition}
            >
              <AgentMessageThread
                messages={messages}
                onSelectionAction={onSelectionAction}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div
        ref={dockRef}
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
          promptSuggestion={promptSuggestion}
          onDismissPromptSuggestion={onDismissPromptSuggestion}
          canSubmit={canSubmit}
          isStreaming={isStreaming}
          modelReady={modelReady}
          modelReference={modelReference}
          effort={effort}
          slashCommand={slashCommand}
          shellRef={composerShellRef}
          editorRef={composerEditorRef}
          onDraftChange={onDraftChange}
          onSlashCommandChange={onSlashCommandChange}
          onModelReferenceChange={onModelReferenceChange}
          onEffortChange={onEffortChange}
          onSubmit={onSubmit}
          onStop={onStop}
        />}
        <div className="mt-1 flex items-center gap-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {runCwd ? (
              <SessionCwdIndicator
                cwd={runCwd}
                onChange={isEmpty && !isStreaming && !runSessionId ? setDraftCwd : undefined}
                className="min-w-0"
              />
            ) : null}
            <SessionGitIndicator cwd={runCwd} sessionId={runSessionId} isStreaming={isStreaming} enabled={!hidden} />
          </div>
          <AnimatePresence initial={false}>
            {isEmpty ? null : (
              <motion.div
                key="composer-context-ring"
                className="ml-auto flex shrink-0 items-center pr-2.5"
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

      <div
        ref={dockSpacerRef}
        aria-hidden="true"
        className="min-h-0 basis-0"
        style={{ flexGrow: isEmpty ? 1 : 0 }}
      />
    </section>
  )
}
