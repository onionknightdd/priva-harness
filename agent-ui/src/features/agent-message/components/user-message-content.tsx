import { useId, useLayoutEffect, useRef, useState } from "react"
import { ChevronDownIcon } from "lucide-react"
import { motion, useReducedMotionConfig } from "motion/react"
import { useTranslation } from "react-i18next"

import { MessageContent } from "@/components/ai-elements/message"
import { Button } from "@/components/ui/button"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

import type { MessageAttachment } from "../message-attachment"
import { MessageSelectionContent } from "./message-selection-quote"
import { QuoteSelectable } from "./quote-selectable"
import { UserMessageAttachments } from "./user-message-attachments"

const PREVIEW_LINES = 5
const OVERFLOW_TOLERANCE = 1

type ContentSize = {
  full: number
  preview: number
  expanded: number
  line: number
  overflows: boolean
}

export function UserMessageContent({ content, attachments, isError = false }: {
  content: string
  attachments?: MessageAttachment[]
  isError?: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  const reduceMotion = Boolean(useReducedMotionConfig())
  const [expanded, setExpanded] = useState(false)
  const [instant, setInstant] = useState(true)
  const [size, setSize] = useState<ContentSize | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const body = bodyRef.current
    const bubble = panelRef.current?.parentElement
    if (!body || !bubble) return

    const measure = () => {
      const line = Number.parseFloat(getComputedStyle(body).lineHeight)
      const full = body.getBoundingClientRect().height
      const textHeight = textRef.current?.getBoundingClientRect().height ?? 0
      const padding = getComputedStyle(bubble)
      const available = (window.visualViewport?.height ?? window.innerHeight) / 2
        - Number.parseFloat(padding.paddingTop) - Number.parseFloat(padding.paddingBottom)
      const next: ContentSize = {
        full,
        line,
        preview: full - textHeight + Math.min(textHeight, PREVIEW_LINES * line),
        expanded: Math.min(full + line, Math.max(line, available)),
        overflows: textHeight > PREVIEW_LINES * line + OVERFLOW_TOLERANCE,
      }
      setSize((previous) => previous && previous.full === next.full && previous.preview === next.preview
        && previous.expanded === next.expanded && previous.line === next.line && previous.overflows === next.overflows
        ? previous : next)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(body)
    window.addEventListener("resize", measure)
    window.visualViewport?.addEventListener("resize", measure)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
      window.visualViewport?.removeEventListener("resize", measure)
    }
  }, [content, attachments])

  const canExpand = size?.overflows ?? false
  const open = canExpand && expanded
  const scrollable = open && size !== null && size.full > size.expanded - size.line + OVERFLOW_TOLERANCE
  const duration = reduceMotion || instant ? 0 : open ? 0.18 : 0.12
  const surface = isError
    ? "color-mix(in oklab, var(--destructive) 10%, var(--background))"
    : "var(--user-message)"

  return (
    <MessageContent
      data-user-message-bubble
      data-layout-scroll-anchor
      data-expanded={open}
      role={isError ? "alert" : undefined}
      className={cn("relative gap-0 whitespace-pre-wrap", open && "max-h-[50dvh]",
        isError && "rounded-xl text-destructive group-[.is-user]:text-destructive")}
      style={{ backgroundColor: surface }}
    >
      <motion.div
        ref={panelRef}
        data-user-message-panel
        className="min-h-0 min-w-0 overflow-hidden"
        initial={false}
        animate={{ height: size ? open ? size.expanded : size.preview : "auto" }}
        transition={{ duration, ease: EASE_OUT }}
        onAnimationComplete={() => setInstant(true)}
        style={{ maxHeight: size ? undefined : `${PREVIEW_LINES}lh` }}
      >
        <div
          ref={viewportRef}
          id={id}
          data-user-message-viewport
          role={scrollable ? "region" : undefined}
          aria-label={scrollable ? t("agentMessage.userMessageContent") : undefined}
          tabIndex={scrollable ? 0 : undefined}
          className={cn("min-h-0 min-w-0 overflow-x-hidden overscroll-contain rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            canExpand && "[scrollbar-gutter:stable] [scrollbar-width:thin]",
            open ? "overflow-y-auto" : "overflow-y-hidden")}
          style={{ height: open ? "calc(100% - 1lh)" : "100%" }}
        >
          {/* Padding also protects text from overlay scrollbars, which do not reserve a gutter. */}
          <div ref={bodyRef} className={cn("flex min-w-0 flex-col gap-2", canExpand && "pr-3")}>
            {attachments?.length ? <UserMessageAttachments attachments={attachments} /> : null}
            {content ? <QuoteSelectable messageRole="user">
              <div ref={textRef} data-user-message-text className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                <MessageSelectionContent content={content} />
              </div>
            </QuoteSelectable> : null}
          </div>
        </div>
      </motion.div>
      {canExpand ? (
        <div
          data-user-message-toggle-row
          className="pointer-events-none absolute inset-x-4 bottom-3 flex h-lh items-center justify-end"
          style={{ backgroundImage: open ? undefined : `linear-gradient(to bottom, transparent, ${surface} 70%)` }}
        >
          <Button
            data-user-message-toggle
            type="button"
            variant="link"
            aria-controls={id}
            aria-expanded={open}
            className="pointer-events-auto h-full gap-1 rounded-xs px-0 text-xs text-muted-foreground motion-reduce:transition-none"
            style={{ backgroundColor: surface }}
            onClick={(event) => {
              setInstant(event.detail === 0)
              if (viewportRef.current) viewportRef.current.scrollTop = 0
              setExpanded(!open)
            }}
          >
            {t(open ? "common.collapse" : "common.expand")}
            <motion.span
              aria-hidden="true"
              className="inline-flex"
              initial={false}
              animate={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
              transition={{ duration, ease: EASE_OUT }}
            >
              <ChevronDownIcon className="size-3" />
            </motion.span>
          </Button>
        </div>
      ) : null}
    </MessageContent>
  )
}
