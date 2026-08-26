"use client"
// beui.dev/components/agents/code-block

import { Check, Copy, FileCode2, LoaderCircle } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
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
import { writeClipboardText } from "@/lib/clipboard"
import { SPRING_PRESS } from "@/lib/ease"
import { cn } from "@/lib/utils"

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
  copyable?: boolean
  onCopy?: () => void | Promise<void>
  className?: string
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
  wrap = false,
  copyable = true,
  onCopy,
  className,
}: CodeBlockProps) {
  const { t } = useTranslation()
  const reduce = useReducedMotion() ?? false
  const viewportRef = useRef<HTMLDivElement>(null)
  const copyTimer = useRef<number | undefined>(undefined)
  const [copied, setCopied] = useState(false)
  const streaming = status === "streaming"
  const highlighted = useAgentShikiHighlight(code, language)
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
    <motion.button
      type="button"
      aria-label={copyLabel}
      title={copyLabel}
      onClick={() => {
        void handleCopy()
      }}
      whileTap={reduce ? undefined : { scale: 0.9 }}
      transition={SPRING_PRESS}
      className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-background/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </motion.button>
  ) : null

  return (
    <div
      data-state={status}
      aria-busy={streaming}
      className={cn(
        "w-full min-w-0 overflow-hidden rounded-2xl bg-muted/80 text-sm",
        className
      )}
    >
      {showHeader ? (
        <div className="flex h-10 items-center gap-2.5 px-3">
          <FileCode2
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground/70"
          />
          {filename ? (
            <span className="min-w-0 truncate font-mono text-xs text-foreground/80">
              {filename}
            </span>
          ) : null}
          <span className="text-[10px] font-medium tracking-wide text-muted-foreground/55 uppercase">
            {language}
          </span>
          <span
            className={cn(
              "ml-auto inline-flex shrink-0 items-center gap-1 text-[10px] font-medium",
              streaming
                ? "text-blue-600 dark:text-blue-400"
                : "text-emerald-600 dark:text-emerald-400"
            )}
          >
            {streaming ? (
              <LoaderCircle className={cn("size-3", !reduce && "animate-spin")} />
            ) : (
              <Check className="size-3" />
            )}
            {streaming ? t("common.codeWriting") : t("common.codeReady")}
          </span>
          {copyButton}
        </div>
      ) : null}

      <div className="relative">
        <div
          ref={viewportRef}
          role={streaming ? "log" : undefined}
          aria-live={streaming ? "polite" : undefined}
          className={cn(
            "overflow-auto py-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
            showHeader && "border-t border-foreground/[0.06]"
          )}
          style={{ maxHeight }}
        >
          <pre
            className={cn(
              "agent-shiki shiki m-0 font-mono text-sm leading-5 text-foreground/85",
              wrap ? "w-full agent-shiki-wrap whitespace-normal" : "inline-block min-w-full whitespace-normal"
            )}
          >
            <code className="block">
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
                        className="shrink-0 select-none px-1.5 text-right tabular-nums text-muted-foreground/35"
                        style={{
                          width: `calc(${String(lineDigits)}ch + 0.75rem)`,
                        }}
                      >
                        {lineNumber}
                      </span>
                    ) : null}
                    <AgentShikiLineContent
                      line={shikiLines?.[index]}
                      fallback={line.content}
                      className={cn(
                        "pr-4",
                        showLineNumbers ? "pl-1" : "pl-4",
                        wrap
                          ? "whitespace-pre-wrap break-words"
                          : "whitespace-pre"
                      )}
                    />
                  </span>
                )
              })}
            </code>
          </pre>
        </div>
        {!showHeader ? (
          <div className="pointer-events-none absolute top-1.5 right-1.5">
            <span className="pointer-events-auto">{copyButton}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
