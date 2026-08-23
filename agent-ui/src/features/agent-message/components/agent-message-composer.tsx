import * as React from "react"
import { ArrowUpIcon, PlusIcon } from "lucide-react"
import { LayoutGroup, motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import { ComposerModelSelector, type ComposerEffort } from "./composer-model-selector"

export const composerDockTransition = {
  duration: 0.4,
  ease: [0.16, 1, 0.3, 1],
} as const

function AttachButton({
  label,
  unavailable,
}: {
  label: string
  unavailable: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <InputGroupButton
          disabled
          size="icon-xs"
          className="rounded-full"
          aria-label={label}
        >
          <PlusIcon />
        </InputGroupButton>
      </TooltipTrigger>
      <TooltipContent>{unavailable}</TooltipContent>
    </Tooltip>
  )
}

function ComposerControls({
  canSubmit,
  modelReady,
  sendLabel,
  modelRequired,
  onModelReferenceChange,
  onEffortChange,
}: {
  canSubmit: boolean
  modelReady: boolean
  sendLabel: string
  modelRequired: string
  onModelReferenceChange: (model: string | null) => void
  onEffortChange: (effort: ComposerEffort) => void
}) {
  return (
    <>
      <div
        className="min-w-0 max-w-full text-xs font-normal"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <ComposerModelSelector
          onModelReferenceChange={onModelReferenceChange}
          onEffortChange={onEffortChange}
        />
      </div>
      <InputGroupButton
        type="submit"
        variant="default"
        size="icon-xs"
        className="rounded-full"
        disabled={!canSubmit}
        aria-label={sendLabel}
        title={modelReady ? sendLabel : modelRequired}
      >
        <ArrowUpIcon />
      </InputGroupButton>
    </>
  )
}

export function AgentMessageComposer({
  compact = false,
  draft,
  canSubmit,
  modelReady,
  onDraftChange,
  onModelReferenceChange,
  onEffortChange,
  onSubmit,
}: {
  compact?: boolean
  draft: string
  canSubmit: boolean
  modelReady: boolean
  onDraftChange: (draft: string) => void
  onModelReferenceChange: (model: string | null) => void
  onEffortChange: (effort: ComposerEffort) => void
  onSubmit: () => void
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const promptId = React.useId()
  const layout = !shouldReduceMotion
  const transition = shouldReduceMotion
    ? { duration: 0 }
    : composerDockTransition
  const slot = { layout, transition }

  return (
    <form
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSubmit) {
          onSubmit()
        }
      }}
    >
      <Field>
        <FieldLabel htmlFor={promptId} className="sr-only">
          {t("agentMessage.promptLabel")}
        </FieldLabel>
        <LayoutGroup>
          <motion.div
            {...slot}
            role="group"
            data-slot="input-group"
            className={cn(
              "group/input-group relative grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] border border-input shadow-xs dark:bg-input/30",
              "has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-3 has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50",
              compact
                ? "h-10 overflow-hidden grid-cols-[auto_minmax(0,1fr)_minmax(0,auto)] grid-rows-1 items-center"
                : "grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto_auto] items-start"
            )}
            style={{ borderRadius: compact ? 9999 : 24 }}
            onClick={(event) => {
              const target = event.target
              if (
                !(target instanceof HTMLElement) ||
                target.closest(
                  "button, a, [role='menuitem'], [data-slot^='dropdown-menu']"
                )
              ) {
                return
              }

              textareaRef.current?.focus()
            }}
          >
            <motion.div
              {...slot}
              className={
                compact
                  ? "col-start-1 row-start-1 pl-2"
                  : "col-start-1 row-start-2 py-2.5 pl-2.5"
              }
            >
              <InputGroupAddon align="inline-start" className="p-0">
                <AttachButton
                  label={t("agentMessage.attach")}
                  unavailable={t("agentMessage.attachUnavailable")}
                />
              </InputGroupAddon>
            </motion.div>
            <motion.div
              {...slot}
              className={
                compact
                  ? "col-start-2 row-start-1 min-w-0"
                  : "col-span-3 row-start-1 min-w-0"
              }
            >
              <motion.div
                layout={layout ? "position" : false}
                transition={transition}
                className="min-w-0 w-full"
              >
                <InputGroupTextarea
                  ref={textareaRef}
                  id={promptId}
                  rows={1}
                  wrap={compact ? "off" : undefined}
                  value={draft}
                  placeholder={t("agentMessage.promptPlaceholder")}
                  className={
                    compact
                      ? "field-sizing-fixed h-8 min-h-8 max-h-8 w-full min-w-0 overflow-hidden px-1 py-0 leading-8 whitespace-nowrap"
                      : "max-h-60 min-h-12 field-sizing-content px-3.5 pt-3.5 pb-0"
                  }
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
            </motion.div>
            <motion.div
              {...slot}
              className={
                compact
                  ? "col-start-3 row-start-1 min-w-0 max-w-64 pr-2"
                  : "col-start-3 row-start-2 py-2.5 pr-2.5"
              }
            >
              <InputGroupAddon
                align="inline-end"
                className="gap-1 p-0 has-[>button]:mr-0!"
              >
                <ComposerControls
                  canSubmit={canSubmit}
                  modelReady={modelReady}
                  sendLabel={t("agentMessage.send")}
                  modelRequired={t("agentMessage.modelRequired")}
                  onModelReferenceChange={onModelReferenceChange}
                  onEffortChange={onEffortChange}
                />
              </InputGroupAddon>
            </motion.div>
          </motion.div>
        </LayoutGroup>
      </Field>
    </form>
  )
}
