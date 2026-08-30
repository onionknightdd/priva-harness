"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { SPRING_LAYOUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

import {
  CONTEXT_USAGE_CATEGORY_SWATCH,
  contextUsagePercent,
  contextUsageSegments,
  contextUsageTone,
  emptyContextUsage,
  formatTokenCount,
  shouldSpringContextUsageFill,
  type ContextUsage,
  type ContextUsageCategoryId,
  type ContextUsageTone,
} from "../context-usage"

const RING_SIZE = 16
const RING_STROKE = 1.75
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

const TONE_CLASS: Record<ContextUsageTone, string> = {
  empty: "text-muted-foreground",
  normal: "text-foreground",
  warn: "text-status-warm",
  crit: "text-destructive",
}

export function ComposerContextRing({
  usage = emptyContextUsage(),
  anchorRef,
  className,
}: {
  usage?: ContextUsage
  anchorRef: React.RefObject<HTMLElement | null>
  className?: string
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const [open, setOpen] = React.useState(false)
  const percent = contextUsagePercent(usage)
  const displayedPercentRef = React.useRef<number | null>(null)
  const springFill = shouldSpringContextUsageFill(
    displayedPercentRef.current,
    percent
  )
  displayedPercentRef.current = percent
  const tone = contextUsageTone(percent)
  const fill = percent === null ? 0 : Math.min(percent, 100) / 100
  const dashOffset = RING_CIRCUMFERENCE * (1 - fill)
  const fillTransition =
    shouldReduceMotion || !springFill ? { duration: 0 } : SPRING_LAYOUT
  const unavailable = t("agentMessage.contextUsage.unavailable")
  const usedLabel =
    usage.used === null ? unavailable : formatTokenCount(usage.used)
  const limitLabel =
    usage.limit === null ? unavailable : formatTokenCount(usage.limit)
  const ariaLabel =
    percent === null
      ? t("agentMessage.contextUsage.aria")
      : t("agentMessage.contextUsage.ariaPercent", { percent })
  const tooltip =
    percent === null
      ? t("agentMessage.contextUsage.tooltipEmpty")
      : t("agentMessage.contextUsage.tooltip", {
          percent,
          used: usedLabel,
          limit: limitLabel,
        })
  const tokensLabel =
    usage.used === null && usage.limit === null
      ? t("agentMessage.contextUsage.tokensEmpty")
      : t("agentMessage.contextUsage.tokens", {
          used: usedLabel,
          limit: limitLabel,
        })
  const fullLabel =
    percent === null
      ? t("agentMessage.contextUsage.empty")
      : t("agentMessage.contextUsage.full", { percent })
  const segments = contextUsageSegments(usage)

  return (
    <div className={cn("flex size-6 items-center justify-center", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <TooltipProvider delay={300}>
          <Tooltip disabled={open}>
            <TooltipTrigger
              render={
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={ariaLabel}
                      data-slot="composer-context-ring"
                    />
                  }
                />
              }
            >
              <ContextRingGraphic
                tone={tone}
                dashOffset={dashOffset}
                transition={fillTransition}
              />
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {tooltip}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <PopoverContent
          anchor={anchorRef}
          align="start"
          side="top"
          sideOffset={8}
          positionMethod="fixed"
          collisionAvoidance={{
            side: "none",
            align: "none",
            fallbackAxisSide: "none",
          }}
          className="w-(--anchor-width) max-w-(--anchor-width) gap-2 p-2.5 text-[13px] motion-reduce:animate-none"
        >
          <PopoverHeader className="flex-row items-center justify-between gap-2">
            <PopoverTitle className="text-[13px] font-normal text-muted-foreground">
              {t("agentMessage.contextUsage.title")}
            </PopoverTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t("common.close")}
              onClick={() => setOpen(false)}
            >
              <XIcon />
            </Button>
          </PopoverHeader>
          <div className="flex items-center justify-between gap-2">
            <PopoverDescription className="text-[13px]">
              {fullLabel}
            </PopoverDescription>
            <p className="text-[13px] tabular-nums">
              {tokensLabel}
            </p>
          </div>
          <ContextUsageBar
            segments={segments}
            percent={percent}
            transition={fillTransition}
          />
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {usage.categories.map((category) => (
              <li
                key={category.id}
                className="flex items-center gap-2 text-xs leading-none"
              >
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-[2px]",
                    CONTEXT_USAGE_CATEGORY_SWATCH[category.id]
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">
                  {t(categoryLabelKey(category.id))}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {category.tokens === null
                    ? unavailable
                    : formatTokenCount(category.tokens)}
                </span>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function ContextUsageBar({
  segments,
  percent,
  transition,
}: {
  segments: ReturnType<typeof contextUsageSegments>
  percent: number | null
  transition: typeof SPRING_LAYOUT | { duration: number }
}) {
  const fills =
    segments.length > 0
      ? segments
      : [{ id: "conversation" as const, fraction: (percent ?? 0) / 100 }]

  return (
    <div
      className={cn(
        "flex h-1 overflow-hidden rounded-full bg-muted",
        segments.length > 0 && "gap-0.5"
      )}
      aria-hidden="true"
    >
      {fills.map((segment) => (
        <motion.span
          key={segment.id}
          className={cn(
            "h-full min-w-0 rounded-[1px]",
            segments.length > 0
              ? CONTEXT_USAGE_CATEGORY_SWATCH[segment.id]
              : "bg-primary"
          )}
          initial={false}
          animate={{ width: `${segment.fraction * 100}%` }}
          transition={transition}
        />
      ))}
    </div>
  )
}

function categoryLabelKey(id: ContextUsageCategoryId) {
  return `agentMessage.contextUsage.category.${id}`
}

function ContextRingGraphic({
  tone,
  dashOffset,
  transition,
}: {
  tone: ContextUsageTone
  dashOffset: number
  transition: typeof SPRING_LAYOUT | { duration: number }
}) {
  return (
    <svg
      viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      className="size-4"
      aria-hidden="true"
    >
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={RING_STROKE}
        className="text-muted-foreground/35"
      />
      <motion.circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        className={TONE_CLASS[tone]}
        initial={false}
        animate={{ strokeDashoffset: dashOffset }}
        transition={transition}
      />
    </svg>
  )
}
