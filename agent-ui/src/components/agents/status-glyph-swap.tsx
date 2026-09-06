"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

import { SPRING_SWAP } from "@/lib/ease";
import { cn } from "@/lib/utils";

export interface StatusGlyphSwapProps {
  /** Remounts the glyph when it changes so the newcomer can animate in. */
  swapKey: string;
  /** Pop the glyph in (scale 0.5 → 1). Pass `false` for initial mounts of
   * already-settled cards and under reduced motion so nothing moves. */
  pop: boolean;
  className?: string;
  children: ReactNode;
}

/** Spinner → check / copy → copied swaps for tool cards: a tiny spring pop
 * marks the moment of change without competing with the text. */
export function StatusGlyphSwap({
  swapKey,
  pop,
  className,
  children,
}: StatusGlyphSwapProps) {
  return (
    <motion.span
      key={swapKey}
      initial={pop ? { scale: 0.5, opacity: 0 } : false}
      animate={{ scale: 1, opacity: 1 }}
      transition={SPRING_SWAP}
      className={cn("grid place-items-center", className)}
    >
      {children}
    </motion.span>
  );
}
