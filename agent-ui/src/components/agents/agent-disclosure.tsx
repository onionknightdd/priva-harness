"use client";

import { motion, type HTMLMotionProps, useReducedMotion } from "motion/react";
import type { CSSProperties } from "react";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

export interface AgentDisclosureProps
  extends Omit<HTMLMotionProps<"div">, "animate" | "initial"> {
  open: boolean;
  openHeight?: CSSProperties["height"];
}

/** Height-only reveal so collapsible agent content always grows downward. */
export function AgentDisclosure({
  open,
  openHeight = "auto",
  className,
  style,
  transition,
  ...props
}: AgentDisclosureProps) {
  const reduce = useReducedMotion() ?? false;

  return (
    <motion.div
      {...props}
      aria-hidden={!open}
      inert={!open}
      initial={false}
      animate={{
        opacity: open ? 1 : 0,
        height: open ? openHeight : 0,
      }}
      transition={
        transition ?? {
          duration: reduce ? 0 : open ? 0.22 : 0.14,
          ease: EASE_OUT,
        }
      }
      className={cn(
        "origin-top overflow-hidden [overflow-anchor:none]",
        className
      )}
      style={{
        ...style,
        pointerEvents: open ? undefined : "none",
      }}
    />
  );
}
