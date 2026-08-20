import * as React from "react"
import { ArrowUpIcon, PlusIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Field, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import { ComposerModelSelector } from "./composer-model-selector"

export function AgentMessageComposer({
  draft,
  canSubmit,
  modelReady,
  onDraftChange,
  onModelReferenceChange,
  onSubmit,
}: {
  draft: string
  canSubmit: boolean
  modelReady: boolean
  onDraftChange: (draft: string) => void
  onModelReferenceChange: (model: string | null) => void
  onSubmit: () => void
}) {
  const { t } = useTranslation()
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const promptId = React.useId()
  const attachLabel = t("agentMessage.attach")
  const attachUnavailable = t("agentMessage.attachUnavailable")

  const submitDraft = () => {
    if (!canSubmit) {
      return
    }

    onSubmit()
  }

  return (
    <form
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault()
        submitDraft()
      }}
    >
      <Field>
        <FieldLabel htmlFor={promptId} className="sr-only">
          {t("agentMessage.promptLabel")}
        </FieldLabel>
        <InputGroup
          className="h-auto rounded-3xl"
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
          <InputGroupTextarea
            ref={textareaRef}
            id={promptId}
            rows={1}
            value={draft}
            placeholder={t("agentMessage.promptPlaceholder")}
            className="max-h-60 min-h-12 field-sizing-content px-3.5 pt-3.5 pb-0"
            onChange={(event) => onDraftChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
          />
          <InputGroupAddon
            align="block-end"
            className="justify-between px-2.5 pt-2.5 pb-2.5"
          >
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <InputGroupButton
                  disabled
                  size="icon-xs"
                  className="rounded-full"
                  aria-label={attachLabel}
                >
                  <PlusIcon />
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>{attachUnavailable}</TooltipContent>
            </Tooltip>
            <div className="flex min-w-0 items-center gap-1">
              <div
                className="min-w-0 text-xs font-normal"
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <ComposerModelSelector
                  onModelReferenceChange={onModelReferenceChange}
                />
              </div>
              <InputGroupButton
                type="submit"
                variant="default"
                size="icon-xs"
                className="rounded-full"
                disabled={!canSubmit}
                aria-label={t("agentMessage.send")}
                title={
                  modelReady
                    ? t("agentMessage.send")
                    : t("agentMessage.modelRequired")
                }
              >
                <ArrowUpIcon />
              </InputGroupButton>
            </div>
          </InputGroupAddon>
        </InputGroup>
      </Field>
    </form>
  )
}
