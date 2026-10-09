"use client";
// beui.dev/components/agents/tool-approval

import {
  Check,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  ShieldCheck,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type ReactNode,
  useCallback,
  useState,
} from "react";
import {
  AgentCode,
  type AgentCodeLanguage,
} from "@/components/agents/agent-code";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { EASE_OUT, SPRING_PRESS } from "@/lib/ease";
import { collapsePanel } from "@/lib/surfaces";
import { cn } from "@/lib/utils";

export type ToolApprovalStatus =
  | "pending"
  | "approving"
  | "approved"
  | "denied"
  | "running"
  | "complete"
  | "error";

export interface ToolApprovalParameter {
  id: string;
  label: ReactNode;
  value: ReactNode;
}

export interface ToolApprovalCodeProps {
  code: string;
  language?: AgentCodeLanguage;
  className?: string;
}

export interface ToolApprovalProps {
  tool: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  parameters?: ToolApprovalParameter[];
  status?: ToolApprovalStatus;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onApprove?: () => void;
  onAlwaysAllow?: () => void;
  onDeny?: () => void;
  className?: string;
  disabled?: boolean;
  labels?: { title: string; collapse: string; expand: string; allow: string; deny: string; alwaysAllow: string; statuses: Record<ToolApprovalStatus, string> };
}

function getStatusCopy(status: ToolApprovalStatus) {
  if (status === "approving") return "Approving";
  if (status === "approved") return "Approved";
  if (status === "denied") return "Denied";
  if (status === "running") return "Running";
  if (status === "complete") return "Completed";
  if (status === "error") return "Failed";
  return "Approval required";
}

function getStatusBadgeClass(status: ToolApprovalStatus) {
  if (status === "pending") {
    return "border-status-warm/30 bg-status-warm/10 text-foreground";
  }
  if (status === "approving" || status === "running") {
    return "border-status-running/30 bg-status-running/10 text-status-running";
  }
  if (status === "approved" || status === "complete") {
    return "border-status-success/30 bg-status-success/10 text-status-success";
  }
  return "border-destructive/30 bg-destructive/10 text-destructive";
}

export function ToolApprovalCode({
  code,
  language = "bash",
  className,
}: ToolApprovalCodeProps) {
  return (
    <AgentCode
      code={code}
      language={language}
      className={cn(
        // Parameter values sit in a narrow grid column with nowhere to scroll
        // on touch, so they wrap instead of clipping (as ToolResultOutput does).
        "whitespace-pre-wrap break-all rounded-lg border border-border/50 bg-muted/30 px-2.5 py-2",
        className,
      )}
    />
  );
}

export function ToolApproval({
  tool,
  title = "Allow this tool to run?",
  description,
  parameters = [],
  status = "pending",
  open,
  defaultOpen = true,
  onOpenChange,
  onApprove,
  onAlwaysAllow,
  onDeny,
  className,
  disabled = false,
  labels,
}: ToolApprovalProps) {
  const reduce = useReducedMotion() ?? false;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [keyboard, setKeyboard] = useState(false);
  const currentOpen = open ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange, open],
  );
  const busy = status === "approving" || status === "running";
  const pending = status === "pending";
  const error = status === "error";

  return (
    <Collapsible
      open={currentOpen}
      onOpenChange={(nextOpen, details) => {
        setKeyboard(!("detail" in details.event) || details.event.detail === 0);
        setOpen(nextOpen);
      }}
      data-state={status}
      aria-busy={busy}
      className={cn(
        "w-full overflow-hidden rounded-2xl border border-border/60 bg-muted/20 text-sm",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-4 py-2">
        <span
          aria-hidden="true"
          className={cn(
            "shrink-0 text-muted-foreground",
            error && "text-destructive",
          )}
        >
          {busy ? (
            <LoaderCircle className={cn("size-4", !reduce && "animate-spin")} />
          ) : error ? (
            <CircleAlert className="size-4" />
          ) : status === "denied" ? (
            <X className="size-4" />
          ) : status === "approved" || status === "complete" ? (
            <Check className="size-4" />
          ) : (
            <ShieldCheck className="size-4" />
          )}
        </span>

        <div className={cn("min-w-0 flex-1 font-medium text-foreground", currentOpen ? "max-h-[25dvh] overflow-y-auto whitespace-pre-wrap break-words" : "truncate")}>{labels?.title ?? title}</div>
        <span className="max-w-1/4 truncate font-mono text-xs text-muted-foreground">{tool}</span>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
            getStatusBadgeClass(status),
          )}
        >
          {labels?.statuses[status] ?? getStatusCopy(status)}
        </span>
        <CollapsibleTrigger data-interaction-toggle aria-label={currentOpen ? labels?.collapse ?? "Collapse" : labels?.expand ?? "Expand"}
          render={<Button size="icon-xs" variant="outline" className="shrink-0 text-foreground" />}>
          <ChevronDown aria-hidden strokeWidth={2.5} className={cn("size-4 transition-transform duration-200 ease-out motion-reduce:transition-none", currentOpen && "rotate-180", (reduce || keyboard) && "transition-none")} />
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent keepMounted inert={!currentOpen} aria-hidden={!currentOpen}
        className={cn(collapsePanel, (reduce || keyboard) && "transition-none")}>
        <div className="max-h-[min(50dvh,28rem)] overflow-y-auto overscroll-contain">
          {description ? <p className="px-4 pb-3 leading-5 text-muted-foreground">{description}</p> : null}
          {parameters.length ? <dl className="mx-4 mb-4 grid gap-2 rounded-xl border border-border/50 bg-background/70 p-3">
            {parameters.map((parameter) => (
              <div
                key={parameter.id}
                className="grid min-w-0 gap-1 text-xs sm:grid-cols-[minmax(0,7rem)_minmax(0,1fr)] sm:items-start sm:gap-3"
              >
                <dt className="text-muted-foreground">{parameter.label}</dt>
                <dd className="min-w-0 break-words font-mono text-foreground/85">
                  {parameter.value}
                </dd>
              </div>
            ))}
          </dl> : null}
        </div>

        <AnimatePresence initial={false}>
          {pending ? (
            <motion.div
              initial={reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(4px)" }}
              animate={{ opacity: 1, transform: "translateY(0px)" }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0.12 : 0.22, ease: EASE_OUT }}
              className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 px-4 py-3"
            >
              <motion.button
                type="button"
                disabled={disabled || !currentOpen || !pending}
                onClick={onApprove}
                whileTap={reduce ? undefined : { transform: "scale(0.97)" }}
                transition={SPRING_PRESS}
                className="disabled:cursor-not-allowed disabled:opacity-50 rounded-xl bg-foreground px-3 py-1.5 text-xs font-medium text-background outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {labels?.allow ?? "Allow once"}
              </motion.button>
              {onAlwaysAllow ? (
                <motion.button
                  type="button"
                  disabled={disabled || !currentOpen || !pending}
                  onClick={onAlwaysAllow}
                  whileTap={reduce ? undefined : { transform: "scale(0.97)" }}
                  transition={SPRING_PRESS}
                  className="rounded-xl border border-border/60 bg-background px-3 py-1.5 text-xs font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {labels?.alwaysAllow ?? "Always allow"}
                </motion.button>
              ) : null}
              <button
                type="button"
                disabled={disabled || !currentOpen || !pending}
                onClick={onDeny}
                className="disabled:cursor-not-allowed disabled:opacity-50 rounded-xl px-3 py-1.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {labels?.deny ?? "Deny"}
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </CollapsibleContent>
    </Collapsible>
  );
}
