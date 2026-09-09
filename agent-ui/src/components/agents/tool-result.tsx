"use client";
// beui.dev/components/agents/tool-result

import {
  Ban,
  Braces,
  Check,
  ChevronDown,
  CircleCheck,
  CircleX,
  CircleHelp,
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
import { useTranslation } from "react-i18next";
import {
  AgentCode,
  type AgentCodeLanguage,
} from "@/components/agents/agent-code";
import { ActionSwapRollText } from "@/components/motion/action-swap-roll";
import { AgentDisclosure } from "@/components/agents/agent-disclosure";
import { StatusGlyphSwap } from "@/components/agents/status-glyph-swap";
import {
  TOOL_OUTPUT_FRAME_CLASS,
  TOOL_OUTPUT_INSET_CLASS,
} from "@/components/agents/tool-output-frame";
import { SPRING_PRESS, SPRING_SWAP } from "@/lib/ease";
import { focusRing } from "@/lib/surfaces";
import { cn } from "@/lib/utils";
import { TooltipHint } from "@/components/ui/tooltip";

export type ToolResultStatus = "running" | "success" | "error" | "cancelled" | "unknown";
export type ToolResultKind = "terminal" | "request" | "custom";

export interface ToolResultProps {
  tool: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
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

const STATUS_LABEL_KEY = {
  unknown: "toolCard.unknown",
  running: "toolCard.running",
  success: "toolCard.completed",
  error: "toolCard.failed",
  cancelled: "toolCard.cancelled",
} as const satisfies Record<ToolResultStatus, string>;

// Status colours come from the shared `status-*` tokens so tool cards, the
// sidebar status dot and diff gutters all speak the same colour language.
const STATUS_CLASS = {
  unknown: "text-muted-foreground",
  running: "text-status-running",
  success: "text-status-success",
  error: "text-status-error",
  cancelled: "text-muted-foreground",
} as const satisfies Record<ToolResultStatus, string>;

const STATUS_ICON = {
  unknown: CircleHelp,
  running: LoaderCircle,
  success: CircleCheck,
  error: CircleX,
  cancelled: Ban,
} as const satisfies Record<ToolResultStatus, typeof LoaderCircle>;

function getSwapKey(value: ReactNode, fallback: string) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
}

function KindIcon({ kind }: { kind: ToolResultKind }) {
  if (kind === "terminal") return <SquareTerminal className="size-[1em]" />;
  if (kind === "request") return <Braces className="size-[1em]" />;
  return <Wrench className="size-[1em]" />;
}

function StatusIcon({
  status,
  settled,
  reduce,
}: {
  status: ToolResultStatus;
  /** True only on the render where the tool just left `running`, so historical
   * cards mount their final icon without a pop. */
  settled: boolean;
  reduce: boolean;
}) {
  const Icon = STATUS_ICON[status];
  return (
    <StatusGlyphSwap swapKey={status} pop={settled && !reduce}>
      <Icon
        className={cn(
          "size-3",
          status === "running" && !reduce && "animate-spin-fast",
        )}
      />
    </StatusGlyphSwap>
  );
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
    <TooltipHint content={label}>
      <motion.button
        type="button"
        aria-label={label}
        onClick={onClick}
        whileTap={reduce ? undefined : { scale: 0.9 }}
        transition={SPRING_PRESS}
        className={cn(
          "grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground",
          focusRing,
        )}
      >
        {/* Keyed on the label so the copied check pops in instead of swapping flat. */}
        <StatusGlyphSwap swapKey={label} pop={!reduce}>
          {children}
        </StatusGlyphSwap>
      </motion.button>
    </TooltipHint>
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
  subtitle,
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
  const { t } = useTranslation();
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
  // `previousStatus` is committed in an effect, so during the render where the
  // status flips it still reads "running" — exactly the frame the icon swaps.
  const settled = previousStatus.current === "running" && !running;
  const canCopy = Boolean(copyText || onCopy);
  const hasActions = canCopy || Boolean(onRetry);
  const titleKey = getSwapKey(title, status);
  const metaKey = getSwapKey(meta, `${status}-meta`);
  const toolKey = getSwapKey(tool, `${status}-tool`);
  const statusLabel = t(STATUS_LABEL_KEY[status]);

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
      className={cn("w-full text-ui", className)}
    >
      <button
        id={triggerId}
        type="button"
        aria-expanded={currentOpen}
        aria-controls={contentId}
        onClick={() => setOpen(!currentOpen)}
        className={cn(
          "group/item flex w-fit max-w-full min-h-0 items-center gap-1 rounded-md py-0.5 text-left",
          focusRing,
        )}
      >
        <span
          aria-hidden="true"
          className="grid size-[1em] shrink-0 place-items-center text-muted-foreground/70"
        >
          {icon ?? <KindIcon kind={kind} />}
        </span>
        <span className="flex min-w-0 flex-none items-baseline gap-2">
          <span className="shrink-0 font-normal text-muted-foreground/70">
            <ActionSwapRollText value={toolKey}>
              {tool}
            </ActionSwapRollText>
          </span>
          <span className="min-w-0 truncate font-normal text-muted-foreground/70">
            <ActionSwapRollText value={titleKey}>
              {title}
            </ActionSwapRollText>
          </span>
          {meta ? (
            <span className="shrink-0 text-muted-foreground/60">
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
            STATUS_CLASS[status],
          )}
        >
          <StatusIcon status={status} settled={settled} reduce={reduce} />
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

      {subtitle ? <div className="pl-[calc(1em+0.25rem)] text-xs text-muted-foreground">{subtitle}</div> : null}

      {children ? (
        <AgentDisclosure
          id={contentId}
          role="region"
          aria-labelledby={triggerId}
          open={currentOpen}
        >
          <div className="pt-1.5 pl-[calc(1em+0.25rem)] text-sm">
            {framed ? (
              <div className={cn(TOOL_OUTPUT_FRAME_CLASS, "group/frame relative")}>
                <div className={TOOL_OUTPUT_INSET_CLASS}>
                  <ToolResultViewport
                    viewportRef={viewportRef}
                    maxHeight={maxHeight}
                    contentClassName={contentClassName}
                    live
                  >
                    {children}
                  </ToolResultViewport>
                </div>
                {hasActions ? (
                  // Actions float over the top-right corner instead of taking a
                  // footer row: the output keeps its full height and the buttons
                  // only surface on hover/focus (always on touch, which has no hover).
                  <div
                    className={cn(
                      "absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-lg bg-tool-output/90 p-0.5 opacity-0 transition-opacity duration-150 ease-out group-hover/frame:opacity-100 group-focus-within/frame:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none",
                      copied && "opacity-100",
                    )}
                  >
                    {canCopy ? (
                      <ToolResultAction
                        label={copied ? t("common.copied") : t("toolCard.copyResult")}
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
                      <ToolResultAction
                        label={t("toolCard.runAgain")}
                        onClick={onRetry}
                      >
                        <RotateCcw className="size-3.5" />
                      </ToolResultAction>
                    ) : null}
                  </div>
                ) : null}
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
