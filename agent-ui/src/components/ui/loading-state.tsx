"use client";

import type { ComponentProps } from "react";
import { useReducedMotionConfig } from "motion/react";

import { cn } from "@/lib/utils";

// Beautiful UI's Drive pattern; the surrounding status line owns its label.
const chevronDelays = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3);
  const column = index % 3;
  return (column + Math.abs(row - 1)) * 90;
});

function LoadingState({ className, ...props }: ComponentProps<"span">) {
  const reduceMotion = useReducedMotionConfig();

  return (
    <span
      {...props}
      aria-hidden="true"
      data-slot="loading-state"
      className={cn("grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px] text-loading-state", className)}
    >
      {chevronDelays.map((delay, index) => (
        <span
          key={index}
          className={cn(
            "size-1 rounded-[1px] bg-current opacity-15",
            !reduceMotion && "animate-loading-state-pixel motion-reduce:animate-none",
          )}
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

export { LoadingState };
