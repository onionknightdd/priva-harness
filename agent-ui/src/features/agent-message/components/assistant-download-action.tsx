import * as React from "react"
import { DownloadIcon, FileCodeIcon, FileTextIcon, ImageIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { PopupsArmedContext } from "@/components/ui/popups-armed-context"
import { TooltipHint } from "@/components/ui/tooltip"

import type { AgentThreadMessage } from "../agent-message-data"
import {
  assistantReplyHasImage,
  assistantReplyMarkdown,
  downloadAssistantReply,
  type ReplyDownloadFormat,
} from "../reply-download"

const ACTION_CLASS = "text-muted-foreground/70 hover:text-muted-foreground"

export function AgentMessageDownloadAction({ message }: { message: AgentThreadMessage }) {
  const { t } = useTranslation()
  const armed = React.useContext(PopupsArmedContext)
  const [failed, setFailed] = React.useState(false)
  const resetTimerRef = React.useRef<number | null>(null)
  const pendingRef = React.useRef(false)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const restoreFocusRef = React.useRef(false)
  const markdown = assistantReplyMarkdown(message)
  const canImage = assistantReplyHasImage(message)
  const label = failed ? t("agentMessage.downloadFailed") : t("agentMessage.download")

  React.useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
    }
  }, [])

  React.useLayoutEffect(() => {
    if (!armed || !restoreFocusRef.current) return
    restoreFocusRef.current = false
    triggerRef.current?.focus()
  }, [armed])

  const fail = () => {
    setFailed(true)
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
    resetTimerRef.current = window.setTimeout(() => {
      setFailed(false)
      resetTimerRef.current = null
    }, 1600)
  }

  const run = (format: ReplyDownloadFormat) => {
    if (pendingRef.current) return
    pendingRef.current = true
    const scope = triggerRef.current?.closest<HTMLElement>("[data-reply-scope]") ?? null
    void downloadAssistantReply(format, message, scope)
      .catch(() => fail())
      .finally(() => {
        pendingRef.current = false
      })
  }

  const icon = <DownloadIcon className="size-3.5" aria-hidden="true" />

  if (!armed) {
    return (
      <TooltipHint content={label}>
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="icon-xs"
          className={ACTION_CLASS}
          aria-label={label}
          onFocus={() => {
            restoreFocusRef.current = true
          }}
        >
          {icon}
        </Button>
      </TooltipHint>
    )
  }

  return (
    <DropdownMenu>
      <TooltipHint content={label}>
        <DropdownMenuTrigger
          render={
            <Button
              ref={triggerRef}
              type="button"
              variant="ghost"
              size="icon-xs"
              className={ACTION_CLASS}
              aria-label={label}
            />
          }
        >
          {icon}
        </DropdownMenuTrigger>
      </TooltipHint>
      <DropdownMenuContent align="start" className="w-auto min-w-44">
        <DropdownMenuItem disabled={!canImage} onClick={() => run("pdf")}>
          <FileTextIcon aria-hidden="true" />
          {t("agentMessage.downloadPdf")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={markdown === ""} onClick={() => run("markdown")}>
          <FileCodeIcon aria-hidden="true" />
          {t("agentMessage.downloadMarkdown")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canImage} onClick={() => run("png")}>
          <ImageIcon aria-hidden="true" />
          {t("agentMessage.downloadPng")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
