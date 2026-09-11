"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

export interface AgentDisclosureProps extends HTMLAttributes<HTMLDivElement> {
  open: boolean;
  /** Let nested layout transitions leave the fully opened panel. */
  overflowWhenOpen?: boolean;
  /** Drop the subtree once the close transition ends. For heavy bodies
   * (process panels with dozens of tool rows); light bodies stay mounted and
   * `inert`, so re-opening never re-highlights code. */
  unmountOnClose?: boolean;
}

/** Height duration; also how long an unmounting body waits before leaving. */
const CLOSE_MS = 200;

/** Height-only reveal so collapsible agent content always grows downward.
 * Opacity leads the height on open (content is solid while still unrolling)
 * and lags it on close (text stays legible until the last 120ms), so the
 * panel reads as a curtain over real content instead of a blur. */
export function AgentDisclosure({
  open,
  overflowWhenOpen = false,
  unmountOnClose = false,
  className,
  style,
  children,
  ...props
}: AgentDisclosureProps) {
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);
  const [settled, setSettled] = useState(open && overflowWhenOpen);
  const mountedRef = useRef(mounted);
  mountedRef.current = mounted;

  useLayoutEffect(() => {
    if (open) {
      if (mountedRef.current) {
        setExpanded(true);
        return;
      }
      // Freshly mounted: paint one frame collapsed so the transition has a start.
      setMounted(true);
      const frame = requestAnimationFrame(() => setExpanded(true));
      return () => cancelAnimationFrame(frame);
    }
    setExpanded(false);
    if (!unmountOnClose) return;
    const timeout = window.setTimeout(() => setMounted(false), CLOSE_MS);
    return () => window.clearTimeout(timeout);
  }, [open, unmountOnClose]);

  useLayoutEffect(() => {
    if (!expanded || !overflowWhenOpen) {
      setSettled(false);
      return;
    }
    // Clip the reveal, then let nested layout transitions move past this box.
    const timeout = window.setTimeout(() => setSettled(true), CLOSE_MS);
    return () => window.clearTimeout(timeout);
  }, [expanded, overflowWhenOpen]);

  if (!mounted) return null;
  const overflow = expanded && settled && overflowWhenOpen
    ? "overflow-visible"
    : "overflow-hidden";

  return (
    <div
      {...props}
      aria-hidden={!expanded}
      inert={!expanded}
      className={cn(
        "grid origin-top [overflow-anchor:none]",
        overflow,
        "ease-out [transition-property:grid-template-rows,opacity] [transition-duration:200ms,120ms] motion-reduce:transition-none",
        expanded
          ? "grid-rows-[1fr] opacity-100 [transition-delay:0ms]"
          : "grid-rows-[0fr] opacity-0 [transition-delay:0ms,80ms]",
        className,
      )}
      style={{
        ...style,
        pointerEvents: expanded ? undefined : "none",
      }}
    >
      <div className={cn("min-h-0 [overflow-anchor:none]", overflow)}>
        {children}
      </div>
    </div>
  );
}
