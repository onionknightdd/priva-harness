"use client";
// beui.dev/components/agents/file-diff

import {
  Check,
  ChevronDown,
  Copy,
  FileCode2,
  LoaderCircle,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AgentCodeLanguage } from "@/components/agents/agent-code";
import { AgentDisclosure } from "@/components/agents/agent-disclosure";
import {
  AgentShikiLineContent,
  useAgentShikiHighlight,
} from "@/components/agents/agent-shiki";
import { toNotationDiffSource } from "@/components/agents/notation-diff";
import {
  TOOL_OUTPUT_FRAME_CLASS,
  TOOL_OUTPUT_INSET_B_CLASS,
  TOOL_OUTPUT_INSET_T_CLASS,
  TOOL_OUTPUT_INSET_X_CLASS,
} from "@/components/agents/tool-output-frame";
import { ActionSwapRollText } from "@/components/motion/action-swap-roll";
import { writeClipboardText } from "@/lib/clipboard";
import { SPRING_PRESS, SPRING_SWAP } from "@/lib/ease";
import { cn } from "@/lib/utils";

export type FileDiffStatus = "streaming" | "complete";
export type FileDiffLineType = "added" | "removed" | "context";

export interface FileDiffLine {
  id: string;
  type?: FileDiffLineType;
  oldLine?: number;
  newLine?: number;
  content: string;
}

export interface FileDiffProps {
  file: ReactNode;
  lines: FileDiffLine[];
  tool?: ReactNode;
  status?: FileDiffStatus;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  collapseOnComplete?: boolean;
  collapseDelayMs?: number;
  maxHeight?: number;
  language?: AgentCodeLanguage;
  icon?: ReactNode;
  copyText?: string;
  onCopy?: () => void | Promise<void>;
  className?: string;
}

function displayLineNumber(line: FileDiffLine): number | undefined {
  if (line.type === "removed") {
    return line.oldLine;
  }
  if (line.type === "added") {
    return line.newLine;
  }
  return line.newLine ?? line.oldLine;
}

function maxDisplayLineDigits(lines: FileDiffLine[]): number {
  let max = 0;
  for (const line of lines) {
    const value = displayLineNumber(line);
    if (typeof value === "number") {
      max = Math.max(max, String(value).length);
    }
  }
  return max;
}

function gutterWidth(digits: number): string | undefined {
  if (digits <= 0) {
    return undefined;
  }
  return `calc(${String(digits)}ch + 0.75rem)`;
}

export function FileDiff({
  file,
  lines,
  tool,
  status = "streaming",
  open,
  defaultOpen = true,
  onOpenChange,
  collapseOnComplete = true,
  collapseDelayMs = 720,
  maxHeight = 220,
  language = "typescript",
  icon,
  copyText,
  onCopy,
  className,
}: FileDiffProps) {
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const contentId = `${baseId}-content`;
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousStatus = useRef(status);
  const copyTimer = useRef<number | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const currentOpen = open ?? internalOpen;
  const streaming = status === "streaming";
  const additions = lines.filter((line) => line.type === "added").length;
  const deletions = lines.filter((line) => line.type === "removed").length;
  const canCopy = Boolean(copyText || onCopy);
  const marked = useMemo(
    () => toNotationDiffSource(lines, language),
    [language, lines],
  );
  const highlighted = useAgentShikiHighlight(marked.code, marked.language, {
    notationDiff: marked.hasMarkers,
  });
  const shikiLines =
    highlighted !== null && highlighted.lines.length === lines.length
      ? highlighted.lines
      : undefined;
  const lineDigits = maxDisplayLineDigits(lines);
  const lineGutterWidth = gutterWidth(lineDigits);

  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange, open],
  );

  useEffect(() => {
    if (previousStatus.current !== "streaming" && status === "streaming") {
      setOpen(true);
    }
    let closeTimer: number | undefined;
    if (
      previousStatus.current === "streaming" &&
      status === "complete" &&
      collapseOnComplete
    ) {
      const delay = reduce ? 0 : collapseDelayMs;
      if (delay <= 0) {
        setOpen(false);
      } else {
        closeTimer = window.setTimeout(() => {
          setOpen(false);
        }, delay);
      }
    }
    previousStatus.current = status;
    return () => {
      if (closeTimer !== undefined) {
        window.clearTimeout(closeTimer);
      }
    };
  }, [collapseDelayMs, collapseOnComplete, reduce, setOpen, status]);

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !currentOpen || !streaming) return;

    const frame = requestAnimationFrame(() => {
      if (viewport.scrollHeight <= viewport.clientHeight) return;
      if (typeof viewport.scrollTo === "function") {
        viewport.scrollTo({
          top: viewport.scrollHeight,
          behavior: reduce ? "auto" : "smooth",
        });
      } else {
        viewport.scrollTop = viewport.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(frame);
  });

  const handleCopy = useCallback(async () => {
    if (onCopy) await onCopy();
    else if (copyText) await writeClipboardText(copyText);

    setCopied(true);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
  }, [copyText, onCopy]);

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
          {icon ?? (
            <FileCode2
              aria-hidden="true"
              className="block size-[1em] shrink-0 text-muted-foreground/70"
            />
          )}
          <span className="flex min-w-0 items-center gap-1 font-medium leading-none text-muted-foreground/70">
            {tool ? (
              typeof tool === "string" || typeof tool === "number" ? (
                <ActionSwapRollText value={String(tool)}>
                  {tool}
                </ActionSwapRollText>
              ) : (
                tool
              )
            ) : null}
            {file}
            {additions > 0 ? (
              <span className="font-normal text-emerald-600 tabular-nums lining-nums dark:text-emerald-400">
                {`+${String(additions)}`}
              </span>
            ) : null}
            {deletions > 0 ? (
              <span className="font-normal text-rose-600 tabular-nums lining-nums dark:text-rose-400">
                {`−${String(deletions)}`}
              </span>
            ) : null}
          </span>
          <span className="grid size-[1em] shrink-0 place-items-center text-muted-foreground/60">
            {streaming ? (
              <LoaderCircle
                aria-label="Applying changes"
                className={cn("size-[1em]", !reduce && "animate-spin")}
              />
            ) : (
              <Check aria-label="Changes applied" className="size-[1em]" />
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
        open={currentOpen}
      >
        <div className="pt-[10px] pl-[calc(1em+0.25rem)]">
          <div className={TOOL_OUTPUT_FRAME_CLASS}>
            <div
              ref={viewportRef}
              data-slot="file-diff-viewport"
              data-assistant-selectable=""
              aria-live="polite"
              className={cn(
                "scrollbar-hide overflow-auto",
                TOOL_OUTPUT_INSET_T_CLASS,
                canCopy ? undefined : TOOL_OUTPUT_INSET_B_CLASS
              )}
              style={{ maxHeight }}
            >
              <pre className="agent-shiki shiki has-diff m-0 inline-block min-w-full whitespace-normal font-mono text-sm leading-5">
                <code className="block">
                  <span className="sr-only">File changes</span>
                  {lines.map((line, index) => {
                    const type = line.type ?? "context";
                    return (
                      <span
                        key={line.id}
                        className={cn(
                          "flex min-w-full",
                          TOOL_OUTPUT_INSET_X_CLASS,
                          type === "added" && "bg-emerald-500/[0.07]",
                          type === "removed" && "bg-rose-500/[0.07]",
                        )}
                      >
                        {lineDigits > 0 ? (
                          <span
                            className="shrink-0 select-none pr-1.5 text-right tabular-nums text-muted-foreground/40"
                            style={
                              lineGutterWidth === undefined
                                ? undefined
                                : { width: lineGutterWidth }
                            }
                          >
                            {displayLineNumber(line)}
                          </span>
                        ) : null}
                        <AgentShikiLineContent
                          line={shikiLines?.[index]}
                          fallback={line.content}
                          className={cn(
                            "whitespace-pre",
                            type === "added" && "diff add",
                            type === "removed" && "diff remove",
                          )}
                        />
                      </span>
                    );
                  })}
                </code>
              </pre>
            </div>

            {canCopy ? (
              <div
                className={cn(
                  "flex justify-end",
                  TOOL_OUTPUT_INSET_X_CLASS,
                  TOOL_OUTPUT_INSET_B_CLASS
                )}
              >
                <motion.button
                  type="button"
                  aria-label={copied ? "Copied" : "Copy diff"}
                  title={copied ? "Copied" : "Copy diff"}
                  onClick={handleCopy}
                  whileTap={reduce ? undefined : { scale: 0.9 }}
                  transition={SPRING_PRESS}
                  className="grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-background/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {copied ? (
                    <Check className="size-3.5" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </motion.button>
              </div>
            ) : null}
          </div>
        </div>
      </AgentDisclosure>
    </div>
  );
}
