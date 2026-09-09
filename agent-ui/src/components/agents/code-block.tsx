"use client"
// beui.dev/components/agents/code-block

import { Check, Copy, FileCode2, LoaderCircle, TextAlignStart, TextWrap } from "lucide-react"
import { ScrollArea } from "@base-ui/react/scroll-area"
import { motion, useInView, useReducedMotion } from "motion/react"
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useTranslation } from "react-i18next"

import type { AgentCodeLanguage } from "@/components/agents/agent-code"
import {
  AgentShikiLineContent,
  useAgentShikiHighlight,
} from "@/components/agents/agent-shiki"
import {
  TOOL_OUTPUT_INSET_CLASS,
  TOOL_OUTPUT_INSET_X_CLASS,
} from "@/components/agents/tool-output-frame"
import { Button } from "@/components/ui/button"
import { writeClipboardText } from "@/lib/clipboard"
import { SPRING_PRESS } from "@/lib/ease"
import { focusRing } from "@/lib/surfaces"
import { cn } from "@/lib/utils"
import { TooltipHint } from "@/components/ui/tooltip"

export type CodeBlockStatus = "streaming" | "complete"

export interface CodeBlockProps {
  code: string
  language?: AgentCodeLanguage
  filename?: ReactNode
  status?: CodeBlockStatus
  showHeader?: boolean
  showLineNumbers?: boolean
  startLine?: number
  highlightLines?: number[]
  maxHeight?: number
  wrap?: boolean
  onWrapChange?: (wrap: boolean) => void
  copyable?: boolean
  deferHighlight?: boolean
  onCopy?: () => void | Promise<void>
  className?: string
  contentClassName?: string
  lineNumberLeftPad?: number
}

export function CodeBlock({
  code,
  language = "text",
  filename,
  status = "complete",
  showHeader = true,
  showLineNumbers = true,
  startLine = 1,
  highlightLines = [],
  maxHeight = 280,
  wrap: controlledWrap,
  onWrapChange,
  copyable = true,
  deferHighlight = false,
  onCopy,
  className,
  contentClassName,
  lineNumberLeftPad = 0,
}: CodeBlockProps) {
  const { t } = useTranslation()
  const reduce = useReducedMotion() ?? false
  const viewportRef = useRef<HTMLDivElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null)
  const nearViewport = useInView(highlightRef, { once: true, margin: "200px" })
  const copyTimer = useRef<number | undefined>(undefined)
  const [copied, setCopied] = useState(false)
  const [internalWrap, setInternalWrap] = useState(false)
  const wrap = controlledWrap ?? internalWrap
  const streaming = status === "streaming"
  const highlighted = useAgentShikiHighlight(code, language, { enabled: !deferHighlight || nearViewport })
  const emphasized = useMemo(
    () => new Set(highlightLines),
    [highlightLines]
  )
  let offset = 0
  const lines = code.split("\n").map((content) => {
    const line = { content, offset }
    offset += content.length + 1
    return line
  })
  const lastLine = startLine + Math.max(lines.length, 1) - 1
  const lineDigits = showLineNumbers
    ? String(Math.max(startLine, lastLine, 1)).length
    : 0
  const shikiLines =
    highlighted !== null && highlighted.lines.length === lines.length
      ? highlighted.lines
      : undefined
  const copyLabel = copied ? t("common.copied") : t("common.copyCode")
  const showCopy = copyable || Boolean(onCopy)

  useEffect(
    () => () => {
      if (copyTimer.current) {
        window.clearTimeout(copyTimer.current)
      }
    },
    []
  )

  useLayoutEffect(() => {
    const viewport = viewportRef.current

    if (!viewport || !streaming) {
      return
    }

    const frame = requestAnimationFrame(() => {
      if (viewport.scrollHeight <= viewport.clientHeight) {
        return
      }

      if (typeof viewport.scrollTo === "function") {
        viewport.scrollTo({
          top: viewport.scrollHeight,
          behavior: reduce ? "auto" : "smooth",
        })
      } else {
        viewport.scrollTop = viewport.scrollHeight
      }
    })

    return () => cancelAnimationFrame(frame)
  }, [code, reduce, streaming])

  const handleCopy = useCallback(async () => {
    try {
      if (onCopy) {
        await onCopy()
      } else {
        await writeClipboardText(code)
      }

      setCopied(true)

      if (copyTimer.current) {
        window.clearTimeout(copyTimer.current)
      }

      copyTimer.current = window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }, [code, onCopy])

  const copyButton = showCopy ? (
    <TooltipHint content={copyLabel}>
      <motion.button
        type="button"
        aria-label={copyLabel}
        onClick={() => {
          void handleCopy()
        }}
        whileTap={reduce ? undefined : { scale: 0.9 }}
        transition={SPRING_PRESS}
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full text-foreground transition-colors hover:bg-background/70",
          focusRing
        )}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </motion.button>
    </TooltipHint>
  ) : null

  return (
    <div
      ref={deferHighlight ? highlightRef : undefined}
      data-state={status}
      aria-busy={streaming}
      className={cn(
        "w-full min-w-0 overflow-hidden rounded-2xl bg-tool-output text-sm [--tool-output-inset:var(--radius-2xl)]",
        className
      )}
    >
      {showHeader ? (
        <div
          className={cn(
            "flex items-center gap-4 border-b border-foreground/[0.06] py-[calc(4rem/9)]",
            TOOL_OUTPUT_INSET_X_CLASS
          )}
        >
          <FileCode2
            aria-hidden="true"
            className="size-4 shrink-0 text-foreground"
          />
          {filename ? (
            <span className="min-w-0 truncate font-mono text-sm text-foreground">
              {filename}
            </span>
          ) : null}
          <span className="text-sm text-foreground">
            {language}
          </span>
          <span
            className={cn(
              "ml-auto inline-flex shrink-0 items-center gap-1.5 text-sm",
              streaming ? "text-status-running" : "text-status-success"
            )}
          >
            {streaming ? (
              <LoaderCircle
                className={cn("size-3.5", !reduce && "animate-spin-fast")}
              />
            ) : (
              <Check className="size-3.5" />
            )}
            {streaming ? t("common.codeWriting") : t("common.codeReady")}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <TooltipHint content={t(wrap ? "common.disableCodeWrap" : "common.enableCodeWrap")}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("common.wrapCode")}
                aria-pressed={wrap}
                onClick={() => {
                  const next = !wrap
                  if (controlledWrap === undefined) setInternalWrap(next)
                  onWrapChange?.(next)
                }}
                className="rounded-full hover:bg-background/70 aria-pressed:bg-background/70"
              >
                {wrap ? (
                  <TextWrap aria-hidden="true" className="size-4" />
                ) : (
                  <TextAlignStart aria-hidden="true" className="size-4" />
                )}
              </Button>
            </TooltipHint>
            {copyButton}
          </div>
        </div>
      ) : null}

      <div className={cn(TOOL_OUTPUT_INSET_CLASS, contentClassName)}>
        <ScrollArea.Root className="group/code-scroll relative">
          <ScrollArea.Viewport
            ref={viewportRef}
            data-slot="code-block-viewport"
            role={streaming ? "log" : undefined}
            aria-live={streaming ? "polite" : undefined}
            className={cn("w-full outline-none", focusRing)}
            style={{ maxHeight }}
          >
            <ScrollArea.Content
              render={<pre />}
              style={{ minWidth: wrap ? "100%" : "fit-content" }}
              className={cn(
                "agent-shiki shiki agent-code-content m-0 font-code text-(length:--text-code) font-light leading-5 text-foreground/85",
                wrap
                  ? "w-full agent-shiki-wrap whitespace-normal"
                  : "inline-block min-w-full whitespace-normal"
              )}
            >
              <code className="block font-code">
                {lines.map((line, index) => {
                  const lineNumber = startLine + index
                  return (
                    <span
                      key={line.offset}
                      className={cn(
                        "flex min-h-5 min-w-full",
                        emphasized.has(index + 1) && "bg-blue-500/[0.07]"
                      )}
                    >
                      {showLineNumbers ? (
                        <span
                          className="shrink-0 select-none pr-3 text-right tabular-nums text-muted-foreground/35"
                          style={{
                            width:
                              lineNumberLeftPad > 0
                                ? `calc(${String(lineDigits)}ch + 0.75rem + ${String(lineNumberLeftPad)}px)`
                                : `calc(${String(lineDigits)}ch + 0.75rem)`,
                            paddingLeft:
                              lineNumberLeftPad > 0
                                ? `${String(lineNumberLeftPad)}px`
                                : undefined,
                          }}
                        >
                          {lineNumber}
                        </span>
                      ) : null}
                      <AgentShikiLineContent
                        line={shikiLines?.[index]}
                        fallback={line.content}
                        className={cn(
                          showLineNumbers ? "pl-2" : undefined,
                          wrap
                            ? "whitespace-pre-wrap wrap-anywhere"
                            : "whitespace-pre"
                        )}
                      />
                    </span>
                  )
                })}
              </code>
            </ScrollArea.Content>
          </ScrollArea.Viewport>
          {(["vertical", "horizontal"] as const).map((orientation) => (
            <ScrollArea.Scrollbar
              key={orientation}
              orientation={orientation}
              data-slot="code-block-scrollbar"
              // Place the horizontal track in the outer padding, below the code.
              style={{ bottom: orientation === "horizontal" ? "calc(var(--spacing) * -2)" : 0 }}
              className="z-10 flex select-none p-0.5 opacity-0 transition-opacity duration-150 data-hovering:opacity-100 data-scrolling:opacity-100 group-has-[:focus-visible]/code-scroll:opacity-100 motion-reduce:transition-none data-[orientation=vertical]:w-2 data-[orientation=horizontal]:h-2 data-[orientation=horizontal]:flex-col"
            >
              <ScrollArea.Thumb className="relative flex-1 rounded-full bg-muted-foreground/40" />
            </ScrollArea.Scrollbar>
          ))}
          <ScrollArea.Corner style={{ bottom: "calc(var(--spacing) * -2)" }} />
          {!showHeader ? (
            <div className="pointer-events-none absolute top-0 right-0">
              <span className="pointer-events-auto">{copyButton}</span>
            </div>
          ) : null}
        </ScrollArea.Root>
      </div>
    </div>
  )
}
