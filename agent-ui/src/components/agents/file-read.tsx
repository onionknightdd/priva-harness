"use client"

import {
  Check,
  ChevronDown,
  FileScan,
  LoaderCircle,
  ScanSearch,
} from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"

import { AgentDisclosure } from "@/components/agents/agent-disclosure"
import { ActionSwapRollText } from "@/components/motion/action-swap-roll"
import { CodeBlock } from "@/components/agents/code-block"
import type { AgentCodeLanguage } from "@/components/agents/agent-code"
import { Lightbox } from "@/components/interior/lightbox"
import { SPRING_SWAP } from "@/lib/ease"
import { cn } from "@/lib/utils"

export type FileReadStatus = "streaming" | "complete"

export type FileReadView =
  | { kind: "text"; content: string; startLine: number }
  | {
      kind: "image"
      mime: string
      b64: string
      width?: number
      height?: number
    }

export interface FileReadProps {
  file: ReactNode
  view?: FileReadView
  imageHint?: boolean
  tool?: ReactNode
  status?: FileReadStatus
  language?: AgentCodeLanguage
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  collapseOnComplete?: boolean
  collapseDelayMs?: number
  maxHeight?: number
  className?: string
}

export function FileRead({
  file,
  view,
  imageHint = false,
  tool = "Read",
  status = "streaming",
  language = "text",
  open,
  defaultOpen = true,
  onOpenChange,
  collapseOnComplete = true,
  collapseDelayMs = 720,
  maxHeight = 220,
  className,
}: FileReadProps) {
  const reduce = useReducedMotion() ?? false
  const baseId = useId()
  const triggerId = `${baseId}-trigger`
  const contentId = `${baseId}-content`
  const originRef = useRef<HTMLElement | null>(null)
  const previousStatus = useRef(status)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const currentOpen = open ?? internalOpen
  const streaming = status === "streaming"
  const kind = view?.kind ?? (imageHint ? "image" : "text")
  const imageSrc =
    view?.kind === "image" ? `data:${view.mime};base64,${view.b64}` : undefined
  const caption = typeof file === "string" ? file : undefined
  const hasBody =
    view?.kind === "text" || (view?.kind === "image" && imageSrc !== undefined)

  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next)
      onOpenChange?.(next)
    },
    [onOpenChange, open]
  )

  useEffect(() => {
    if (previousStatus.current !== "streaming" && status === "streaming") {
      setOpen(true)
    }
    let closeTimer: number | undefined
    if (
      previousStatus.current === "streaming" &&
      status === "complete" &&
      collapseOnComplete
    ) {
      const delay = reduce ? 0 : collapseDelayMs
      if (delay <= 0) {
        setOpen(false)
      } else {
        closeTimer = window.setTimeout(() => {
          setOpen(false)
        }, delay)
      }
    }
    previousStatus.current = status
    return () => {
      if (closeTimer !== undefined) {
        window.clearTimeout(closeTimer)
      }
    }
  }, [collapseDelayMs, collapseOnComplete, reduce, setOpen, status])

  const Icon = kind === "image" ? ScanSearch : FileScan

  return (
    <div
      data-state={status}
      aria-busy={streaming}
      className={cn("w-full text-base", className)}
    >
      <div className="group/item relative flex w-fit max-w-full min-h-0 items-center gap-1">
        <button
          id={triggerId}
          type="button"
          aria-expanded={currentOpen}
          aria-controls={contentId}
          onClick={() => setOpen(!currentOpen)}
          className="absolute inset-0 z-0 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="sr-only">{currentOpen ? "Collapse" : "Expand"}</span>
        </button>
        <div className="pointer-events-none relative z-10 flex min-w-0 items-center gap-1 py-0.5">
          <Icon
            aria-hidden="true"
            className="block size-[1em] shrink-0 text-muted-foreground/70"
          />
          <span className="flex min-w-0 flex-none items-center gap-2 leading-none">
            {tool ? (
              <span className="shrink-0 font-medium text-muted-foreground/70">
                {typeof tool === "string" || typeof tool === "number" ? (
                  <ActionSwapRollText value={String(tool)}>
                    {tool}
                  </ActionSwapRollText>
                ) : (
                  tool
                )}
              </span>
            ) : null}
            <span className="min-w-0 truncate font-medium text-muted-foreground/70">
              {file}
            </span>
          </span>
          <span className="grid size-[1em] shrink-0 place-items-center text-muted-foreground/60">
            {streaming ? (
              <LoaderCircle
                aria-label="Reading file"
                className={cn("size-[1em]", !reduce && "animate-spin")}
              />
            ) : (
              <Check aria-label="File read" className="size-[1em]" />
            )}
          </span>
          <motion.span
            aria-hidden="true"
            animate={{ rotate: currentOpen ? 180 : 0 }}
            transition={reduce ? { duration: 0 } : SPRING_SWAP}
            className="grid size-[1em] shrink-0 place-items-center text-muted-foreground/70 opacity-0 transition-[opacity,transform] duration-200 group-hover/item:opacity-100 group-focus-within/item:opacity-100 motion-reduce:transition-none"
          >
            <ChevronDown className="size-[1em]" />
          </motion.span>
        </div>
      </div>

      <AgentDisclosure
        id={contentId}
        role="region"
        aria-labelledby={triggerId}
        open={currentOpen && hasBody}
      >
        <div className="pt-[10px] pl-[calc(1em+0.25rem)]">
          {view?.kind === "text" ? (
            <div className="pl-[4px]" data-assistant-selectable="">
              <CodeBlock
                code={view.content}
                language={language}
                status={status}
                showHeader={false}
                startLine={view.startLine}
                maxHeight={maxHeight}
                className="rounded-xl"
              />
            </div>
          ) : null}
          {view?.kind === "image" && imageSrc !== undefined ? (
            <div className="pl-[4px]">
              <motion.button
                type="button"
                aria-label={
                  caption ? `View ${caption}` : "View image"
                }
                onClick={(event) => {
                  originRef.current = event.currentTarget
                  setLightboxOpen(true)
                }}
                whileHover={reduce ? undefined : { scale: 1.01 }}
                whileTap={reduce ? undefined : { scale: 0.99 }}
                transition={SPRING_SWAP}
                className="block max-w-full overflow-hidden rounded-xl border border-border bg-muted/80 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <img
                  src={imageSrc}
                  alt={caption ?? ""}
                  width={view.width}
                  height={view.height}
                  className="max-h-72 max-w-full object-contain"
                />
              </motion.button>
              <Lightbox
                open={lightboxOpen}
                onClose={() => setLightboxOpen(false)}
                originRef={originRef}
                src={imageSrc}
                alt={caption ?? ""}
                caption={caption}
                width={view.width}
                height={view.height}
              />
            </div>
          ) : null}
        </div>
      </AgentDisclosure>
    </div>
  )
}
