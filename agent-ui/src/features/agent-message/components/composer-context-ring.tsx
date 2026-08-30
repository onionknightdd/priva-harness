"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
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
  className,
}: {
  usage?: ContextUsage
  className?: string
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const [open, setOpen] = React.useState(false)
  const percent = contextUsagePercent(usage)
  const tone = contextUsageTone(percent)
  const fill = percent === null ? 0 : Math.min(percent, 100) / 100
  const dashOffset = RING_CIRCUMFERENCE * (1 - fill)
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
    <div
      className={cn("flex size-6 items-center justify-center", className)}
    >
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
                reduceMotion={shouldReduceMotion}
              />
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              {tooltip}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <PopoverContent
          align="end"
          side="top"
          sideOffset={8}
          className="w-72 gap-3 p-3 motion-reduce:animate-none"
        >
          <PopoverHeader className="flex-row items-center justify-between gap-2">
            <PopoverTitle>{t("agentMessage.contextUsage.title")}</PopoverTitle>
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
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{fullLabel}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {tokensLabel}
              </p>
            </div>
            {segments.length > 0 ? (
              <div
                className="flex h-1.5 overflow-hidden rounded-full bg-muted"
                aria-hidden="true"
              >
                {segments.map((segment) => (
                  <span
                    key={segment.id}
                    className={cn(
                      "h-full min-w-0",
                      CONTEXT_USAGE_CATEGORY_SWATCH[segment.id]
                    )}
                    style={{ width: `${segment.fraction * 100}%` }}
                  />
                ))}
              </div>
            ) : (
              <Progress value={percent ?? 0} className="gap-0" />
            )}
          </div>
          <ItemGroup className="gap-1">
            {usage.categories.map((category) => (
              <Item key={category.id} size="xs" className="px-0 py-1">
                <ItemMedia>
                  <span
                    className={cn(
                      "size-2 rounded-sm",
                      CONTEXT_USAGE_CATEGORY_SWATCH[category.id]
                    )}
                    aria-hidden="true"
                  />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>
                    {t(categoryLabelKey(category.id))}
                  </ItemTitle>
                </ItemContent>
                <ItemActions>
                  <span className="text-muted-foreground tabular-nums">
                    {category.tokens === null
                      ? unavailable
                      : formatTokenCount(category.tokens)}
                  </span>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function categoryLabelKey(id: ContextUsageCategoryId) {
  return `agentMessage.contextUsage.category.${id}`
}

function ContextRingGraphic({
  tone,
  dashOffset,
  reduceMotion,
}: {
  tone: ContextUsageTone
  dashOffset: number
  reduceMotion: boolean
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
        transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        className={TONE_CLASS[tone]}
        initial={false}
        animate={{ strokeDashoffset: dashOffset }}
        transition={reduceMotion ? { duration: 0 } : SPRING_LAYOUT}
      />
    </svg>
  )
}
