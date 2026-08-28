import * as React from "react"
import { ArrowUpIcon, SquareIcon } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { SPRING_LAYOUT } from "@/lib/ease"
import { cn } from "@/lib/utils"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Separator } from "@/components/ui/separator"

import {
  createComposerAttachments,
  revokeComposerAttachment,
  type ComposerAttachment,
} from "../composer-attachments"
import { composerPrimaryAction } from "../composer-primary-action"
import { ComposerAttachMenu } from "./composer-attach-menu"
import { ComposerAttachmentChips } from "./composer-attachment-chips"
import { ComposerModelSelector, COMPOSER_MODEL_TRIGGER_MAX_CLASS, type ComposerEffort } from "./composer-model-selector"

export const composerDockTransition = {
  duration: 0.4,
  ease: [0.16, 1, 0.3, 1],
} as const

const COMPOSER_FOOTER_HEIGHT = 40
const COMPOSER_MULTI_PAD = 14
const COMPOSER_SINGLE_PAD_Y = 8
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

  measureContext.font = getComputedStyle(source).font
  return measureContext.measureText(text).width
}

function useOffsetWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = React.useState(0)

  React.useLayoutEffect(() => {
    const element = ref.current

    if (!element) {
      return
    }

    const update = () => {
      setWidth(element.offsetWidth)
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return width
}

function useCompactLineOverflow(
  draft: string,
  compact: boolean,
  shellRef: React.RefObject<HTMLDivElement | null>,
  leftRef: React.RefObject<HTMLDivElement | null>,
  rightRef: React.RefObject<HTMLDivElement | null>,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
) {
  const [overflows, setOverflows] = React.useState(false)

  const update = React.useCallback(() => {
    if (!compact) {
      setOverflows(false)
      return
    }

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
    const textarea = textareaRef.current

    if (!shell || !left || !right || !textarea) {
      return
    }

    const available = shell.clientWidth - left.offsetWidth - right.offsetWidth

    if (available <= 0) {
      return
    }

    const textWidth = measureTextWidth(draft, textarea)

    setOverflows((current) => {
      if (current) {
        return textWidth > available - COMPACT_LINE_SLACK_PX
      }

      return textWidth > available
    })
  }, [compact, draft, leftRef, rightRef, shellRef, textareaRef])

  React.useLayoutEffect(() => {
    update()

    if (!compact) {
      return
    }

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
  }, [compact, leftRef, rightRef, shellRef, update])

  return overflows
}

function ComposerControls({
  action,
  canSubmit,
  modelReady,
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
  sendLabel: string
  stopLabel: string
  modelRequired: string
  onStop: () => void
  onModelReferenceChange: (model: string | null) => void
  onEffortChange: (effort: ComposerEffort) => void
}) {
  const shouldReduceMotion = Boolean(useReducedMotion())
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
          onModelReferenceChange={onModelReferenceChange}
          onEffortChange={onEffortChange}
        />
      </div>
      <Separator
        orientation="vertical"
        className="mx-0.5 h-4 data-vertical:self-center"
      />
      <InputGroupButton
        type={stopping ? "button" : "submit"}
        variant="default"
        size="icon-xs"
        className="relative z-10 shrink-0 rounded-full"
        disabled={!stopping && !canSubmit}
        aria-label={actionLabel}
        title={stopping ? stopLabel : modelReady ? sendLabel : modelRequired}
        onClick={
          stopping
            ? (event) => {
                event.preventDefault()
                onStop()
              }
            : undefined
        }
      >
        <span className="relative flex size-4 items-center justify-center">
          <AnimatePresence initial={false} mode="wait">
            <motion.span
              key={action}
              initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.72 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.72 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.16 }}
              className="flex items-center justify-center"
            >
              {stopping ? (
                <SquareIcon className="size-2.5 fill-current" />
              ) : (
                <ArrowUpIcon />
              )}
            </motion.span>
          </AnimatePresence>
        </span>
      </InputGroupButton>
    </div>
  )
}

export function AgentMessageComposer({
  compact = false,
  draft,
  canSubmit,
  isStreaming = false,
  modelReady,
  onDraftChange,
  onModelReferenceChange,
  onEffortChange,
  onSubmit,
  onStop,
}: {
  compact?: boolean
  draft: string
  canSubmit: boolean
  isStreaming?: boolean
  modelReady: boolean
  onDraftChange: (draft: string) => void
  onModelReferenceChange: (model: string | null) => void
  onEffortChange: (effort: ComposerEffort) => void
  onSubmit: () => void
  onStop: () => void
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const shellRef = React.useRef<HTMLDivElement>(null)
  const leftRef = React.useRef<HTMLDivElement>(null)
  const rightRef = React.useRef<HTMLDivElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const attachmentsRef = React.useRef<ComposerAttachment[]>([])
  const [attachments, setAttachments] = React.useState<ComposerAttachment[]>(
    []
  )
  attachmentsRef.current = attachments
  const leftWidth = useOffsetWidth(leftRef)
  const rightWidth = useOffsetWidth(rightRef)
  const overflowsCompactLine = useCompactLineOverflow(
    draft,
    compact,
    shellRef,
    leftRef,
    rightRef,
    textareaRef
  )
  const singleLine =
    compact && attachments.length === 0 && !overflowsCompactLine
  const promptId = React.useId()
  const transition = shouldReduceMotion ? { duration: 0 } : SPRING_LAYOUT
  const primaryAction = composerPrimaryAction(draft, isStreaming)
  const fieldPadLeft = singleLine
    ? leftWidth || 42
    : COMPOSER_MULTI_PAD
  const fieldPadRight = singleLine
    ? rightWidth || 212
    : COMPOSER_MULTI_PAD

  React.useEffect(() => {
    return () => {
      attachmentsRef.current.forEach(revokeComposerAttachment)
    }
  }, [])

  const addAttachments = React.useCallback((files: File[]) => {
    setAttachments((current) => [
      ...current,
      ...createComposerAttachments(files),
    ])
  }, [])

  const removeAttachment = React.useCallback((id: string) => {
    setAttachments((current) => {
      const removed = current.find((attachment) => attachment.id === id)
      if (removed) {
        revokeComposerAttachment(removed)
      }
      return current.filter((attachment) => attachment.id !== id)
    })
  }, [])

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
          className={cn(
            "group/input-group relative w-full min-w-0 overflow-hidden rounded-3xl border border-input shadow-xs dark:bg-input/30",
            "has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-3 has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50"
          )}
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

            textareaRef.current?.focus()
          }}
        >
          <ComposerAttachmentChips
            attachments={attachments}
            onRemove={removeAttachment}
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
                  : COMPOSER_MULTI_PAD,
                paddingBottom: singleLine
                  ? COMPOSER_SINGLE_PAD_Y
                  : COMPOSER_FOOTER_HEIGHT,
              }}
              transition={transition}
              className="min-w-0"
            >
              <InputGroupTextarea
                ref={textareaRef}
                id={promptId}
                rows={1}
                wrap={singleLine ? "off" : "soft"}
                value={draft}
                placeholder={t("agentMessage.promptPlaceholder")}
                data-agent-composer="prompt"
                className={cn(
                  "w-full min-w-0 px-0 py-0 text-base!",
                  singleLine
                    ? "field-sizing-fixed h-8 min-h-8 max-h-8 overflow-hidden leading-8 whitespace-nowrap"
                    : cn(
                        "max-h-60 field-sizing-content",
                        compact ? "min-h-8" : "min-h-12"
                      )
                )}
                onChange={(event) => onDraftChange(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey) {
                    return
                  }

                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }}
              />
            </motion.div>
          </div>
          <div
            className={cn(
              "pointer-events-none absolute z-10 flex items-center",
              singleLine ? "inset-0" : "inset-x-0 bottom-0 h-10"
            )}
          >
            <div ref={leftRef} className="pointer-events-auto pl-2.5">
              <InputGroupAddon align="inline-start" className="p-0">
                <ComposerAttachMenu onFilesSelected={addAttachments} />
              </InputGroupAddon>
            </div>
            <div className="min-w-0 flex-1" />
            <div
              ref={rightRef}
              className="pointer-events-auto min-w-0 shrink-0 pr-2.5"
            >
              <InputGroupAddon
                align="inline-end"
                className="min-w-0 justify-end gap-1 p-0 has-[>button]:mr-0!"
              >
                <ComposerControls
                  action={primaryAction}
                  canSubmit={canSubmit}
                  modelReady={modelReady}
                  sendLabel={t("agentMessage.send")}
                  stopLabel={t("agentMessage.stop")}
                  modelRequired={t("agentMessage.modelRequired")}
                  onStop={onStop}
                  onModelReferenceChange={onModelReferenceChange}
                  onEffortChange={onEffortChange}
                />
              </InputGroupAddon>
            </div>
          </div>
        </div>
      </Field>
    </form>
  )
}
