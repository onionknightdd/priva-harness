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
  useRef,
  useState,
} from "react";
import {
  type AgentCodeLanguage,
  AgentCodeLine,
  useAgentCodeTokens,
} from "@/components/agents/agent-code";
import { AgentDisclosure } from "@/components/agents/agent-disclosure";
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

function lineNumberGridTemplate(digits: number): string {
  const columns: string[] = [];
  if (digits > 0) {
    columns.push(`calc(${String(digits)}ch + 0.75rem)`);
  }
  columns.push("1rem", "minmax(0,1fr)");
  return columns.join(" ");
}

function ChangeCount({ value, type }: { value: number; type: "added" | "removed" }) {
  if (!value) return null;
  return (
    <span
      className={cn(
        "font-mono text-xs tabular-nums",
        type === "added"
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-rose-600 dark:text-rose-400",
      )}
    >
      {type === "added" ? "+" : "−"}
      {value}
    </span>
  );
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
  const code = lines.map((line) => line.content).join("\n");
  const tokens = useAgentCodeTokens(code, language);
  const lineDigits = maxDisplayLineDigits(lines);
  const gridTemplateColumns = lineNumberGridTemplate(lineDigits);

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
      className={cn("w-full text-sm", className)}
    >
      <button
        id={triggerId}
        type="button"
        aria-expanded={currentOpen}
        aria-controls={contentId}
        onClick={() => setOpen(!currentOpen)}
        className="group/item flex w-fit max-w-full min-h-0 items-center gap-1 rounded-md py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {icon ?? (
          <FileCode2
            aria-hidden="true"
            className="size-[1em] shrink-0 text-muted-foreground/70"
          />
        )}
        <span className="flex min-w-0 flex-none items-baseline gap-2">
          {tool ? (
            <span className="shrink-0 font-medium text-muted-foreground/70">
              {tool}
            </span>
          ) : null}
          <span className="min-w-0 truncate font-medium text-muted-foreground/70">
            {file}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <ChangeCount value={additions} type="added" />
          <ChangeCount value={deletions} type="removed" />
        </span>
        <span className="grid size-4 shrink-0 place-items-center text-muted-foreground/60">
          {streaming ? (
            <LoaderCircle
              aria-label="Applying changes"
              className={cn("size-3.5", !reduce && "animate-spin")}
            />
          ) : (
            <Check aria-label="Changes applied" className="size-3.5" />
          )}
        </span>
        <motion.span
          aria-hidden="true"
          animate={{ rotate: currentOpen ? 180 : 0 }}
          transition={reduce ? { duration: 0 } : SPRING_SWAP}
          className="shrink-0 text-muted-foreground/70 opacity-0 transition-[opacity,transform] duration-200 group-hover/item:opacity-100 group-focus-visible/item:opacity-100 motion-reduce:transition-none"
        >
          <ChevronDown className="size-3.5" />
        </motion.span>
      </button>

      <AgentDisclosure
        id={contentId}
        role="region"
        aria-labelledby={triggerId}
        open={currentOpen}
      >
        <div className="pt-[10px] pl-[calc(1em+0.25rem)]">
          <div className="overflow-hidden rounded-xl bg-muted/80">
            <div
              ref={viewportRef}
              data-slot="file-diff-viewport"
              aria-live="polite"
              className="scrollbar-hide overflow-auto pl-[4px]"
              style={{ maxHeight }}
            >
              <div className="font-mono text-xs leading-5">
                <span className="sr-only">File changes</span>
                {lines.map((line, index) => {
                  const type = line.type ?? "context";
                  return (
                    <div
                      key={line.id}
                      className={cn(
                        "grid",
                        type === "added" && "bg-emerald-500/[0.07]",
                        type === "removed" && "bg-rose-500/[0.07]",
                      )}
                      style={{ gridTemplateColumns }}
                    >
                      {lineDigits > 0 ? (
                        <span className="select-none px-1.5 text-right tabular-nums text-muted-foreground/40">
                          {displayLineNumber(line)}
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          "select-none text-center text-muted-foreground/45",
                          type === "added" &&
                            "text-emerald-600 dark:text-emerald-400",
                          type === "removed" &&
                            "text-rose-600 dark:text-rose-400",
                        )}
                      >
                        {type === "added"
                          ? "+"
                          : type === "removed"
                            ? "−"
                            : ""}
                      </span>
                      <AgentCodeLine
                        code={line.content}
                        tokens={tokens?.[index]}
                        className="min-w-0 whitespace-pre px-1.5"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {canCopy ? (
              <div className="flex justify-end px-2 pb-1.5 pt-1">
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
