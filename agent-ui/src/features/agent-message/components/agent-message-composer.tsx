import * as React from "react"
import { ArrowUpIcon, SquareIcon } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import type { SlashCommand } from "@/lib/api/slash-commands"
import { SPRING_LAYOUT } from "@/lib/ease"
import { cn } from "@/lib/utils"
import { ActionSwapRollIcon } from "@/components/motion/action-swap-roll"
import { Field, FieldLabel } from "@/components/ui/field"
import { InputGroupButton } from "@/components/ui/input-group"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"

import type { ComposerAttachment } from "../composer-attachments"
import { composerPrimaryAction } from "../composer-primary-action"
import {
  applySlashSelection,
  filterSlashCommands,
  parseSlashTrigger,
  slashOptionId,
  visibleSlashCommands,
} from "../composer-slash-command"
import {
  completeMentionQuery,
  type MentionTrigger,
} from "../composer-mention"
import { useComposerMentionListing } from "../use-composer-mention"
import { useSlashCommandCatalog } from "../use-slash-command-catalog"
import { ComposerAttachMenu } from "./composer-attach-menu"
import { ComposerAttachmentChips } from "./composer-attachment-chips"
import { ComposerModelSelector, COMPOSER_MODEL_TRIGGER_MAX_CLASS, type ComposerEffort } from "./composer-model-selector"
import { ComposerMentionMenu } from "./composer-mention-menu"
import { ComposerSlashChip } from "./composer-slash-chip"
import { ComposerSlashMenu } from "./composer-slash-menu"
import { ComposerEditor, type ComposerEditorHandle } from "./composer-editor"
import { messageSelectionDisplayText, parseMessageSelections } from "../message-select-action"
import { TooltipHint } from "@/components/ui/tooltip"
import "./composer-editor.css"

export const composerDockTransition = {
  duration: 0.4,
  ease: [0.16, 1, 0.3, 1],
} as const

// Scale the footer's vertical padding while keeping its 32px controls intact.
const COMPOSER_FOOTER_HEIGHT = 32 + (8 * 2) / 3
const COMPOSER_MULTI_PAD_X = 14
const COMPOSER_MULTI_PAD_TOP = 8
const COMPOSER_SINGLE_PAD_Y = (7 * 2) / 3
const COMPOSER_CHIP_GAP = 8
const COMPOSER_LEFT_FALLBACK_PX = 46
const COMPACT_LINE_SLACK_PX = 8

let measureContext: CanvasRenderingContext2D | null = null

function measureTextWidth(text: string, source: HTMLElement) {
  if (typeof document === "undefined") {
    return 0
  }

  if (!measureContext) {
    measureContext = document.createElement("canvas").getContext("2d")
  }

  if (!measureContext) {
    return 0
  }

  const font = getComputedStyle(source)
  // The editor disables ligatures, which cannot be serialized into the CSS
  // font shorthand in every browser. Measure with explicit font properties.
  measureContext.font = `${font.fontStyle} ${font.fontWeight} ${font.fontSize} ${font.fontFamily}`
  return measureContext.measureText(text).width
}

function useOffsetWidth(
  ref: React.RefObject<HTMLElement | null>,
  enabled = true
) {
  const [width, setWidth] = React.useState(0)

  React.useLayoutEffect(() => {
    const element = ref.current

    if (!enabled || !element) {
      setWidth(0)
      return
    }

    const update = () => {
      setWidth(element.offsetWidth)
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [enabled, ref])

  return width
}

function useLineOverflow(
  draft: string,
  shellRef: React.RefObject<HTMLDivElement | null>,
  leftRef: React.RefObject<HTMLDivElement | null>,
  rightRef: React.RefObject<HTMLDivElement | null>,
  inputRef: React.RefObject<HTMLDivElement | null>,
  leadingWidth = 0,
  quoteCount = 0
) {
  const [overflows, setOverflows] = React.useState(false)

  const update = React.useCallback(() => {
    if (draft.includes("\n")) {
      setOverflows(true)
      return
    }

    if (draft.length === 0) {
      setOverflows(false)
      return
    }

    const shell = shellRef.current
    const left = leftRef.current
    const right = rightRef.current
    const input = inputRef.current

    if (!shell || !left || !right || !input) {
      return
    }

    const available =
      shell.clientWidth - left.offsetWidth - right.offsetWidth - leadingWidth

    if (available <= 0) {
      return
    }

    const textWidth = measureTextWidth(draft, input) + quoteCount * (parseFloat(getComputedStyle(input).fontSize) + 4)

    setOverflows((current) => {
      if (current) {
        return textWidth > available - COMPACT_LINE_SLACK_PX
      }

      return textWidth > available
    })
  }, [draft, leadingWidth, leftRef, rightRef, shellRef, inputRef, quoteCount])

  React.useLayoutEffect(() => {
    update()

    const shell = shellRef.current
    const left = leftRef.current
    const right = rightRef.current

    if (!shell) {
      return
    }

    const observer = new ResizeObserver(update)
    observer.observe(shell)

    if (left) {
      observer.observe(left)
    }

    if (right) {
      observer.observe(right)
    }

    return () => observer.disconnect()
  }, [leftRef, rightRef, shellRef, update])

  return overflows
}

function ComposerControls({
  action,
  canSubmit,
  modelReady,
  modelReference,
  effort,
  sendLabel,
  stopLabel,
  modelRequired,
  onStop,
  onModelReferenceChange,
  onEffortChange,
}: {
  action: "send" | "stop"
  canSubmit: boolean
  modelReady: boolean
  modelReference: string | null
  effort: ComposerEffort
  sendLabel: string
  stopLabel: string
  modelRequired: string
  onStop: () => void
  onModelReferenceChange: (model: string | null) => void
  onEffortChange: (effort: ComposerEffort) => void
}) {
  const stopping = action === "stop"
  const actionLabel = stopping ? stopLabel : sendLabel

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div
        className={cn(
          COMPOSER_MODEL_TRIGGER_MAX_CLASS,
          "w-max min-w-0 overflow-hidden text-sm font-normal"
        )}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <ComposerModelSelector
          modelReference={modelReference}
          effort={effort}
          onModelReferenceChange={onModelReferenceChange}
          onEffortChange={onEffortChange}
        />
      </div>
      <Separator
        orientation="vertical"
        className="mx-0.5 h-4 data-vertical:self-center"
      />
      <TooltipHint content={stopping ? stopLabel : modelReady ? sendLabel : modelRequired}>
        <InputGroupButton
          type={stopping ? "button" : "submit"}
          variant="default"
          size="icon-xs"
          className="relative z-10 shrink-0 rounded-full"
          disabled={!stopping && !canSubmit}
          aria-label={actionLabel}
          onClick={
            stopping
              ? (event) => {
                  event.preventDefault()
                  onStop()
                }
              : undefined
          }
        >
          {/* Roll swap (same language as tool-card titles) — the leaving and
              arriving glyphs overlap, so the button is never empty mid-swap. */}
          <ActionSwapRollIcon value={action} className="size-4">
            {stopping ? (
              <SquareIcon className="size-2.5 fill-current" />
            ) : (
              <ArrowUpIcon />
            )}
          </ActionSwapRollIcon>
        </InputGroupButton>
      </TooltipHint>
    </div>
  )
}

export function AgentMessageComposer({
  compact = false,
  attachments,
  onFilesSelected,
  onAttachmentRemove,
  onAttachmentRetry,
  draft,
  promptSuggestion,
  onDismissPromptSuggestion,
  canSubmit,
  isStreaming = false,
  modelReady,
  modelReference,
  effort,
  slashCommand,
  shellRef: shellRefProp,
  editorRef: editorRefProp,
  onDraftChange,
  onSlashCommandChange,
  onModelReferenceChange,
  onEffortChange,
  onSubmit,
  onStop,
}: {
  compact?: boolean
  attachments: ComposerAttachment[]
  onFilesSelected: (files: File[]) => void
  onAttachmentRemove: (id: string) => void
  onAttachmentRetry: (id: string) => void
  draft: string
  promptSuggestion?: string
  onDismissPromptSuggestion?: () => void
  canSubmit: boolean
  isStreaming?: boolean
  modelReady: boolean
  modelReference: string | null
  effort: ComposerEffort
  slashCommand: SlashCommand | null
  shellRef?: React.RefObject<HTMLDivElement | null>
  editorRef?: React.RefObject<ComposerEditorHandle | null>
  onDraftChange: (draft: string) => void
  onSlashCommandChange: (command: SlashCommand | null) => void
  onModelReferenceChange: (model: string | null) => void
  onEffortChange: (effort: ComposerEffort) => void
  onSubmit: () => void
  onStop: () => void
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const localShellRef = React.useRef<HTMLDivElement>(null)
  const shellRef = shellRefProp ?? localShellRef
  const leftRef = React.useRef<HTMLDivElement>(null)
  const rightRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLDivElement>(null)
  const localEditorRef = React.useRef<ComposerEditorHandle>(null)
  const editorRef = editorRefProp ?? localEditorRef
  const chipRef = React.useRef<HTMLDivElement>(null)
  const catalog = useSlashCommandCatalog()
  const [dismissedQuery, setDismissedQuery] = React.useState<string | null>(null)
  const [dismissedMention, setDismissedMention] = React.useState<string | null>(null)
  const [highlightedIndex, setHighlightedIndex] = React.useState(0)
  const [mentionTrigger, setMentionTrigger] = React.useState<MentionTrigger | null>(null)
  const slashTrigger =
    slashCommand === null ? parseSlashTrigger(draft) : null
  const slashQuery = slashTrigger?.query ?? null
  const filteredCommands = React.useMemo(
    () =>
      slashQuery === null
        ? []
        : visibleSlashCommands(filterSlashCommands(catalog, slashQuery)),
    [catalog, slashQuery]
  )
  const slashMenuOpen =
    slashTrigger !== null && dismissedQuery !== slashTrigger.query
  const mentionQuery = mentionTrigger?.query ?? null
  const mentionMenuOpen =
    mentionTrigger !== null &&
    !slashMenuOpen &&
    dismissedMention !== mentionTrigger.query
  const mentionListing = useComposerMentionListing(
    mentionMenuOpen ? mentionTrigger : null
  )
  const leftWidth = useOffsetWidth(leftRef)
  const rightWidth = useOffsetWidth(rightRef)
  const chipWidth = useOffsetWidth(chipRef, slashCommand !== null)
  const chipOccupy =
    slashCommand && chipWidth > 0 ? chipWidth + COMPOSER_CHIP_GAP : 0
  const draftParts = React.useMemo(() => parseMessageSelections(draft), [draft])
  const overflowsLine = useLineOverflow(
    messageSelectionDisplayText(draftParts),
    shellRef,
    leftRef,
    rightRef,
    inputRef,
    chipOccupy,
    draftParts.filter((part) => part.type === "selection").length
  )
  // The home composer starts at two lines. A session composer stays one line
  // until the draft or an attachment needs the footer layout.
  const singleLine = compact && attachments.length === 0 && !overflowsLine
  const promptId = React.useId()
  const slashMenuId = React.useId()
  const mentionMenuId = React.useId()
  const transition = shouldReduceMotion ? { duration: 0 } : SPRING_LAYOUT
  const primaryAction = composerPrimaryAction(
    draft,
    isStreaming,
    slashCommand !== null,
    attachments.length > 0
  )
  const visibleSuggestion = !isStreaming && draft === "" && !slashCommand && attachments.length === 0 && !mentionMenuOpen && !slashMenuOpen
    ? promptSuggestion : undefined
  const acceptSuggestion = () => {
    if (!visibleSuggestion) return
    onDraftChange(visibleSuggestion)
    requestAnimationFrame(() => editorRef.current?.focus(true))
  }
  const fieldPadLeft = singleLine
    ? leftWidth || COMPOSER_LEFT_FALLBACK_PX
    : COMPOSER_MULTI_PAD_X
  const fieldPadRight = singleLine
    ? rightWidth || 212
    : COMPOSER_MULTI_PAD_X

  React.useEffect(() => {
    setHighlightedIndex(0)
    if (slashQuery === null) {
      setDismissedQuery(null)
    }
  }, [slashQuery])

  React.useEffect(() => {
    setHighlightedIndex(0)
    if (mentionQuery === null) {
      setDismissedMention(null)
    }
  }, [mentionQuery])

  React.useEffect(() => {
    const count = mentionMenuOpen
      ? mentionListing.entries.length
      : filteredCommands.length
    if (highlightedIndex < count) {
      return
    }
    setHighlightedIndex(0)
  }, [
    filteredCommands.length,
    highlightedIndex,
    mentionListing.entries.length,
    mentionMenuOpen,
  ])

  const selectSlashCommand = React.useCallback(
    (command: SlashCommand) => {
      onSlashCommandChange(command)
      onDraftChange(applySlashSelection(draft))
      setDismissedQuery(null)
      requestAnimationFrame(() => {
        editorRef.current?.focus(true)
      })
    },
    [draft, editorRef, onDraftChange, onSlashCommandChange]
  )

  const closeSlashMenu = React.useCallback(() => {
    if (slashQuery !== null) {
      setDismissedQuery(slashQuery)
    }
  }, [slashQuery])

  const closeMentionMenu = React.useCallback(() => {
    if (mentionQuery !== null) {
      setDismissedMention(mentionQuery)
    }
  }, [mentionQuery])

  const selectMention = React.useCallback(
    (entry: (typeof mentionListing.entries)[number]) => {
      if (!mentionTrigger) {
        return
      }
      const next = completeMentionQuery(
        mentionTrigger.query,
        entry.name,
        entry.type
      )
      editorRef.current?.replaceRange(
        mentionTrigger.from,
        mentionTrigger.to,
        `@${next.query}`
      )
      if (next.close) {
        setDismissedMention(next.query)
      }
    },
    [editorRef, mentionTrigger]
  )

  return (
    <form
      className="w-full min-w-0"
      onSubmit={(event) => {
        event.preventDefault()
        if (primaryAction === "stop") {
          return
        }
        if (canSubmit) {
          onSubmit()
        }
      }}
    >
      <Field>
        <FieldLabel htmlFor={promptId} className="sr-only">
          {t("agentMessage.promptLabel")}
        </FieldLabel>
        <div
          ref={shellRef}
          role="group"
          data-slot="input-group"
          data-composer-line={singleLine ? "single" : "multi"}
          className="group/input-group relative w-full min-w-0 overflow-hidden rounded-3xl border border-input shadow-xs dark:bg-input/30"
          onClick={(event) => {
            const target = event.target
            if (
              !(target instanceof HTMLElement) ||
              target.closest(
                "button, a, [role='menuitem'], [data-slot^='dropdown-menu'], [data-slot^='menu']"
              )
            ) {
              return
            }

            editorRef.current?.focus()
          }}
        >
          <ComposerAttachmentChips
            attachments={attachments}
            onRemove={onAttachmentRemove}
            onRetry={onAttachmentRetry}
          />
          <ComposerSlashMenu
            open={slashMenuOpen}
            menuId={slashMenuId}
            commands={filteredCommands}
            highlightedIndex={highlightedIndex}
            anchorRef={shellRef}
            inputRef={inputRef}
            onOpenChange={(open) => {
              if (!open) {
                closeSlashMenu()
              }
            }}
            onHighlight={setHighlightedIndex}
            onSelect={selectSlashCommand}
          />
          <ComposerMentionMenu
            open={mentionMenuOpen}
            menuId={mentionMenuId}
            entries={mentionListing.entries}
            empty={
              mentionListing.status === "loading"
                ? t("agentMessage.mentionLoading")
                : mentionListing.status === "error"
                  ? (mentionListing.error ?? t("agentMessage.mentionEmpty"))
                  : t("agentMessage.mentionEmpty")
            }
            highlightedIndex={highlightedIndex}
            anchorRef={shellRef}
            inputRef={inputRef}
            onOpenChange={(open) => {
              if (!open) {
                closeMentionMenu()
              }
            }}
            onHighlight={setHighlightedIndex}
            onSelect={selectMention}
          />
          <div
            className="min-w-0"
            style={{
              paddingLeft: fieldPadLeft,
              paddingRight: fieldPadRight,
            }}
          >
            <motion.div
              initial={false}
              animate={{
                paddingTop: singleLine
                  ? COMPOSER_SINGLE_PAD_Y
                  : COMPOSER_MULTI_PAD_TOP,
                paddingBottom: singleLine
                  ? COMPOSER_SINGLE_PAD_Y
                  : COMPOSER_FOOTER_HEIGHT,
              }}
              transition={transition}
              className="min-w-0"
            >
              <div className="relative min-w-0 w-full">
                <AnimatePresence initial={false}>
                  {slashCommand ? (
                    <div
                      ref={chipRef}
                      className="absolute top-0 left-0 z-10 flex h-8 items-center"
                    >
                      <ComposerSlashChip
                        key={slashCommand.name}
                        command={slashCommand}
                        onRemove={() => onSlashCommandChange(null)}
                      />
                    </div>
                  ) : null}
                </AnimatePresence>
                <ComposerEditor
                  ref={editorRef}
                  inputRef={inputRef}
                  id={promptId}
                  draft={draft}
                  placeholder={
                    visibleSuggestion ? "" : (slashCommand?.argumentHint ??
                    t("agentMessage.promptPlaceholder"))
                  }
                  aria-description={visibleSuggestion ? t("agentMessage.promptSuggestionHint", { suggestion: visibleSuggestion }) : undefined}
                  aria-label={t("agentMessage.promptLabel")}
                  // Screen readers learn about the slash listbox and follow the
                  // highlighted option; keyboard handling below already exists.
                  aria-autocomplete="list"
                  aria-controls={
                    mentionMenuOpen
                      ? mentionMenuId
                      : slashMenuOpen
                        ? slashMenuId
                        : undefined
                  }
                  aria-activedescendant={
                    mentionMenuOpen && mentionListing.entries.length > 0
                      ? slashOptionId(mentionMenuId, highlightedIndex)
                      : slashMenuOpen && filteredCommands.length > 0
                        ? slashOptionId(slashMenuId, highlightedIndex)
                        : undefined
                  }
                  style={
                    chipOccupy > 0 ? { textIndent: chipOccupy } : undefined
                  }
                  className={cn(
                    "w-full min-w-0 px-0 py-0 text-base! leading-8",
                    singleLine
                      ? "h-8 min-h-8 max-h-8 overflow-hidden"
                      : cn(
                          "max-h-60 overflow-y-auto",
                          compact ? "min-h-8" : "min-h-16"
                        )
                  )}
                  onChange={onDraftChange}
                  onMentionChange={setMentionTrigger}
                  onKeyDown={(event, atStart) => {
                    if (visibleSuggestion && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
                      if (event.key === "Tab" || event.key === "ArrowRight") {
                        event.preventDefault()
                        acceptSuggestion()
                        return true
                      }
                      if (event.key === "Escape") {
                        event.preventDefault()
                        onDismissPromptSuggestion?.()
                        return true
                      }
                    }
                    if (mentionMenuOpen) {
                      if (event.key === "ArrowDown") {
                        event.preventDefault()
                        if (mentionListing.entries.length === 0) {
                          return true
                        }
                        setHighlightedIndex(
                          (current) =>
                            (current + 1) % mentionListing.entries.length
                        )
                        return true
                      }
                      if (event.key === "ArrowUp") {
                        event.preventDefault()
                        if (mentionListing.entries.length === 0) {
                          return true
                        }
                        setHighlightedIndex(
                          (current) =>
                            (current - 1 + mentionListing.entries.length) %
                            mentionListing.entries.length
                        )
                        return true
                      }
                      if (event.key === "Escape") {
                        event.preventDefault()
                        closeMentionMenu()
                        return true
                      }
                      if (
                        (event.key === "Enter" && !event.shiftKey) ||
                        (event.key === "Tab" && !event.shiftKey)
                      ) {
                        event.preventDefault()
                        const selected =
                          mentionListing.entries[highlightedIndex]
                        if (selected) {
                          selectMention(selected)
                        }
                        return true
                      }
                    }

                    if (slashMenuOpen) {
                      if (event.key === "ArrowDown") {
                        event.preventDefault()
                        if (filteredCommands.length === 0) {
                          return true
                        }
                        setHighlightedIndex(
                          (current) => (current + 1) % filteredCommands.length
                        )
                        return true
                      }
                      if (event.key === "ArrowUp") {
                        event.preventDefault()
                        if (filteredCommands.length === 0) {
                          return true
                        }
                        setHighlightedIndex(
                          (current) =>
                            (current - 1 + filteredCommands.length) %
                            filteredCommands.length
                        )
                        return true
                      }
                      if (event.key === "Escape") {
                        event.preventDefault()
                        closeSlashMenu()
                        return true
                      }
                      if (
                        (event.key === "Enter" && !event.shiftKey) ||
                        (event.key === "Tab" && !event.shiftKey)
                      ) {
                        const selected = filteredCommands[highlightedIndex]
                        if (selected) {
                          event.preventDefault()
                          selectSlashCommand(selected)
                          return true
                        }
                      }
                    }

                    if (
                      event.key === "Backspace" &&
                      slashCommand !== null &&
                      atStart
                    ) {
                      event.preventDefault()
                      onSlashCommandChange(null)
                      return true
                    }

                    if (event.key !== "Enter" || event.shiftKey) {
                      return false
                    }

                    event.preventDefault()
                    inputRef.current?.closest("form")?.requestSubmit()
                    return true
                  }}
                />
                {visibleSuggestion ? (
                  <motion.div key={visibleSuggestion} className="absolute inset-x-0 top-0"
                    initial={shouldReduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }}
                    transition={{ duration: shouldReduceMotion ? 0 : 0.15 }}>
                    <Button type="button" variant="ghost" size="sm"
                      data-prompt-suggestion="true"
                      className="h-8 w-full min-w-0 justify-start gap-2 px-0 font-normal text-muted-foreground/60 hover:bg-transparent hover:text-muted-foreground"
                      aria-label={t("agentMessage.acceptPromptSuggestion", { suggestion: visibleSuggestion })}
                      title={visibleSuggestion}
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={acceptSuggestion}>
                      <span className="min-w-0 truncate">{visibleSuggestion}</span>
                      <kbd className="ml-auto hidden shrink-0 rounded bg-muted px-1.5 text-xs sm:inline-flex" aria-hidden="true">Tab</kbd>
                    </Button>
                  </motion.div>
                ) : null}
              </div>
            </motion.div>
          </div>
          <div
            className={cn(
              "pointer-events-none absolute z-10 flex items-center",
              singleLine ? "inset-0" : "inset-x-0 bottom-0"
            )}
            style={singleLine ? undefined : { height: COMPOSER_FOOTER_HEIGHT }}
          >
            {/* The bar itself snaps between the inline row and the footer; the
                controls glide there on the same spring as the editor padding,
                so nothing teleports when the draft wraps to a second line. */}
            <motion.div
              ref={leftRef}
              layout="position"
              transition={transition}
              className="pointer-events-auto flex h-8 items-center pr-1 pl-2.5"
            >
              <ComposerAttachMenu onFilesSelected={onFilesSelected} />
            </motion.div>
            <div className="min-w-0 flex-1" />
            <motion.div
              ref={rightRef}
              layout="position"
              transition={transition}
              className="pointer-events-auto flex h-8 min-w-0 shrink-0 items-center pr-2.5"
            >
              <ComposerControls
                action={primaryAction}
                canSubmit={canSubmit}
                modelReady={modelReady}
                modelReference={modelReference}
                effort={effort}
                sendLabel={t("agentMessage.send")}
                stopLabel={t("agentMessage.stop")}
                modelRequired={t("agentMessage.modelRequired")}
                onStop={onStop}
                onModelReferenceChange={onModelReferenceChange}
                onEffortChange={onEffortChange}
              />
            </motion.div>
          </div>
        </div>
      </Field>
    </form>
  )
}
