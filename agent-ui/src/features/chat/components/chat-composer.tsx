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

export function ChatComposer({
  draft,
  onDraftChange,
  onSubmit,
}: {
  draft: string
  onDraftChange: (draft: string) => void
  onSubmit: () => void
}) {
  const { t } = useTranslation()
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const promptId = React.useId()
  const canSubmit = draft.trim().length > 0
  const attachLabel = t("chat.attach")
  const attachUnavailable = t("chat.attachUnavailable")

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
          {t("chat.promptLabel")}
        </FieldLabel>
        <InputGroup
          className="h-auto"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("button")) {
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
            placeholder={t("chat.promptPlaceholder")}
            className="max-h-60 min-h-12 field-sizing-content"
            onChange={(event) => onDraftChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
          />
          <InputGroupAddon align="block-end" className="justify-between">
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <InputGroupButton
                  disabled
                  aria-label={attachLabel}
                >
                  <PlusIcon />
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>{attachUnavailable}</TooltipContent>
            </Tooltip>
            <InputGroupButton
              type="submit"
              variant="default"
              size="icon-xs"
              disabled={!canSubmit}
              aria-label={t("chat.send")}
            >
              <ArrowUpIcon />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </Field>
    </form>
  )
}
