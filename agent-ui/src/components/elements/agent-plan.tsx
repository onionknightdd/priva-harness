"use client";

import type { ComponentProps } from "react";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { pct, progressOf } from "@/lib/range";
import { mono } from "@/lib/surfaces";

export function AgentPlan({
  steps,
  activeIndex,
  title = "Plan",
  hideHeader = false,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "steps" | "activeIndex"> & {
  steps: readonly string[];
  activeIndex: number;
  title?: string;
  hideHeader?: boolean;
}) {
  const total = steps.length;
  const completed = progressOf(activeIndex, total);
  const allDone = completed >= total;
  const progress = pct(completed, total);

  return (
    <div
      data-slot="agent-plan"
      className={cn("flex w-full max-w-sm flex-col gap-3", className)}

      {...props}
    >
      {hideHeader ? null : (
        <div className="flex items-center justify-between">
          <span className="text-[13.5px] font-medium">{title}</span>
          <span className={cn(mono, "text-foreground/35 tabular-nums")}>
            {completed} of {total}
          </span>
        </div>
      )}
      <div className="bg-foreground/[0.06] h-[3px] w-full overflow-hidden rounded-full">
        <span
          className="bg-foreground/80 block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${progress}%` }}
        />
      </div>
      <ul
        className={cn(
          "flex min-h-0 flex-col gap-2.5 overflow-y-auto overscroll-contain scrollbar-thin",
          steps.length > 10 && "max-h-[calc(10*1rem+9*0.625rem)]",
        )}
      >
        {steps.map((step, i) => {
          const done = allDone || i < completed;
          const active = !allDone && i === completed;
          return (
            <li key={`${i}:${step}`} className="flex min-h-4 shrink-0 items-center gap-2.5 text-[13.5px]">
              <span className="flex size-4 shrink-0 items-center justify-center">
                {done ? (
                  <span
                    aria-hidden
                    className="flex size-3.5 items-center justify-center rounded-full bg-emerald-500 text-white dark:bg-emerald-400 dark:text-background"
                  >
                    <CheckIcon className="size-2.5" strokeWidth={3} />
                  </span>
                ) : active ? (
                  <Loader2Icon className="text-foreground/90 size-3.5 animate-spin motion-reduce:animate-none" />
                ) : (
                  <span
                    aria-hidden
                    className="bg-foreground/15 size-1.5 rounded-full"
                  />
                )}
              </span>
              <span
                className={cn(
                  done
                    ? "text-muted-foreground line-through"
                    : "text-foreground"
                )}
              >
                {step}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
