"use client";
// beui.dev/components/agents/tool-result

import {
  Ban,
  Braces,
  Check,
  ChevronDown,
  CircleCheck,
  CircleX,
  Copy,
  LoaderCircle,
  RotateCcw,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  AgentCode,
  type AgentCodeLanguage,
} from "@/components/agents/agent-code";
import { ActionSwapRollText } from "@/components/motion/action-swap-roll";
import { AgentDisclosure } from "@/components/agents/agent-disclosure";
import {
  TOOL_OUTPUT_FRAME_CLASS,
  TOOL_OUTPUT_INSET_CLASS,
} from "@/components/agents/tool-output-frame";
import { SPRING_PRESS, SPRING_SWAP } from "@/lib/ease";
import { cn } from "@/lib/utils";

export type ToolResultStatus = "running" | "success" | "error" | "cancelled";
export type ToolResultKind = "terminal" | "request" | "custom";

export interface ToolResultProps {
  tool: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  status?: ToolResultStatus;
  kind?: ToolResultKind;
  meta?: ReactNode;
  icon?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  collapseOnComplete?: boolean;
  collapseDelayMs?: number;
  maxHeight?: number;
  copyText?: string;
  onCopy?: () => void | Promise<void>;
  onRetry?: () => void;
  framed?: boolean;
  className?: string;
  contentClassName?: string;
}

export interface ToolResultOutputProps {
  children: string;
  language?: AgentCodeLanguage;
  className?: string;
}

function getStatusLabel(status: ToolResultStatus) {
  if (status === "running") return "Running";
  if (status === "success") return "Completed";
  if (status === "error") return "Failed";
  return "Cancelled";
}

function getSwapKey(value: ReactNode, fallback: string) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
}

function getStatusClass(status: ToolResultStatus) {
  if (status === "running") {
    return "text-blue-600 dark:text-blue-400";
  }
  if (status === "success") {
    return "text-emerald-600 dark:text-emerald-400";
  }
  if (status === "error") {
    return "text-rose-600 dark:text-rose-400";
  }
  return "text-muted-foreground";
}

function KindIcon({ kind }: { kind: ToolResultKind }) {
  if (kind === "terminal") return <SquareTerminal className="size-[1em]" />;
  if (kind === "request") return <Braces className="size-[1em]" />;
  return <Wrench className="size-[1em]" />;
}

function StatusIcon({
  status,
  reduce,
}: {
  status: ToolResultStatus;
  reduce: boolean;
}) {
  if (status === "running") {
    return <LoaderCircle className={cn("size-3", !reduce && "animate-spin")} />;
  }
  if (status === "success") return <CircleCheck className="size-3" />;
  if (status === "error") return <CircleX className="size-3" />;
  return <Ban className="size-3" />;
}

function ToolResultAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const reduce = useReducedMotion() ?? false;

  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      whileTap={reduce ? undefined : { scale: 0.9 }}
      transition={SPRING_PRESS}
      className="grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </motion.button>
  );
}

function ToolResultViewport({
  viewportRef,
  maxHeight,
  contentClassName,
  live = false,
  children,
}: {
  viewportRef: RefObject<HTMLDivElement | null>;
  maxHeight: number;
  contentClassName?: string;
  live?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      ref={viewportRef}
      role={live ? "log" : "region"}
      aria-live={live ? "polite" : undefined}
      className="overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      style={{ maxHeight }}
    >
      <div className={contentClassName} data-assistant-selectable="">
        {children}
      </div>
    </div>
  );
}

export function ToolResultOutput({
  children,
  language = "bash",
  className,
}: ToolResultOutputProps) {
  return (
    <AgentCode
      code={children}
      language={language}
      className={cn(
        "whitespace-pre-wrap break-words leading-none text-foreground/80",
        className,
      )}
    />
  );
}

export function ToolResult({
  tool,
  title,
  children,
  status = "running",
  kind = "custom",
  meta,
  icon,
  open,
  defaultOpen = true,
  onOpenChange,
  collapseOnComplete = true,
  collapseDelayMs = 720,
  maxHeight = 220,
  copyText,
  onCopy,
  onRetry,
  framed = true,
  className,
  contentClassName,
}: ToolResultProps) {
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
  const running = status === "running";
  const canCopy = Boolean(copyText || onCopy);
  const hasActions = canCopy || Boolean(onRetry);
  const titleKey = getSwapKey(title, status);
  const metaKey = getSwapKey(meta, `${status}-meta`);
  const toolKey = getSwapKey(tool, `${status}-tool`);
  const statusLabel = getStatusLabel(status);

  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange, open],
  );

  useEffect(() => {
    if (previousStatus.current !== "running" && status === "running") {
      setOpen(true);
    }
    let closeTimer: number | undefined;
    if (
      previousStatus.current === "running" &&
      status !== "running" &&
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
    if (!viewport || !currentOpen || !running) return;

    const frame = requestAnimationFrame(() => {
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
    else if (copyText) await navigator.clipboard?.writeText(copyText);

    setCopied(true);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
  }, [copyText, onCopy]);

  return (
    <div
      data-state={status}
      aria-busy={running}
      className={cn("w-full text-base", className)}
    >
      <button
        id={triggerId}
        type="button"
        aria-expanded={currentOpen}
        aria-controls={contentId}
        onClick={() => setOpen(!currentOpen)}
        className="group/item flex w-fit max-w-full min-h-0 items-center gap-1 rounded-md py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span
          aria-hidden="true"
          className="grid size-[1em] shrink-0 place-items-center text-muted-foreground/70"
        >
          {icon ?? <KindIcon kind={kind} />}
        </span>
        <span className="flex min-w-0 flex-none items-baseline gap-2">
          <span className="shrink-0 font-medium text-muted-foreground/70">
            <ActionSwapRollText value={toolKey}>
              {tool}
            </ActionSwapRollText>
          </span>
          <span className="min-w-0 truncate font-medium text-muted-foreground/70">
            <ActionSwapRollText value={titleKey}>
              {title}
            </ActionSwapRollText>
          </span>
          {meta ? (
            <span className="shrink-0 text-sm text-muted-foreground/60">
              <ActionSwapRollText value={metaKey}>
                {meta}
              </ActionSwapRollText>
            </span>
          ) : null}
        </span>
        <span
          aria-label={statusLabel}
          className={cn(
            "inline-flex shrink-0 items-center",
            getStatusClass(status),
          )}
        >
          <StatusIcon status={status} reduce={reduce} />
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

      {children ? (
        <AgentDisclosure
          id={contentId}
          role="region"
          aria-labelledby={triggerId}
          open={currentOpen}
        >
          <div className="pt-1.5 pl-[calc(1em+0.25rem)]">
            {framed ? (
              <div className={TOOL_OUTPUT_FRAME_CLASS}>
                <div className={TOOL_OUTPUT_INSET_CLASS}>
                  <ToolResultViewport
                    viewportRef={viewportRef}
                    maxHeight={maxHeight}
                    contentClassName={contentClassName}
                    live
                  >
                    {children}
                  </ToolResultViewport>
                  {hasActions ? (
                    <div className="flex items-center gap-0.5">
                      {canCopy ? (
                        <ToolResultAction
                          label={copied ? "Copied" : "Copy result"}
                          onClick={handleCopy}
                        >
                          {copied ? (
                            <Check className="size-3.5" />
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                        </ToolResultAction>
                      ) : null}
                      {onRetry ? (
                        <ToolResultAction label="Run again" onClick={onRetry}>
                          <RotateCcw className="size-3.5" />
                        </ToolResultAction>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <ToolResultViewport
                viewportRef={viewportRef}
                maxHeight={maxHeight}
                contentClassName={contentClassName}
              >
                {children}
              </ToolResultViewport>
            )}
          </div>
        </AgentDisclosure>
      ) : null}
    </div>
  );
}
