import { format, parseISO } from "date-fns"
import { enUS, zhCN } from "date-fns/locale"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useId, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { Tabs, TabsList, TabsTrigger } from "@/components/assistant-ui/tabs"
import { DateTimePicker } from "@/components/datetime-picker"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { formatTokenCount } from "@/features/agent-message/context-usage"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

import {
  matchingPreset,
  presetRange,
  RANGE_PRESETS,
  type LocalDateRange,
  type RangePreset,
  type UsageRangeSummary,
} from "./usage-api"
import { USAGE_HEATMAP_WIDTH } from "./usage-heatmap"
import { useUsageRange } from "./use-usage-range"

const DEFAULT_PRESET: RangePreset = 365
const CUSTOM_RANGE = "custom"

// Numbers swap in place when the range changes; a short fade on the new
// value reads as an update, not a reload. Keyed on the text so an unchanged
// number stays still.
const VALUE_CLASS_NAME =
  "motion-safe:transition-opacity motion-safe:duration-150 motion-safe:ease-out starting:opacity-0"

function isPreset(value: unknown): value is RangePreset {
  return typeof value === "string" && RANGE_PRESETS.some((days) => String(days) === value)
}

function localToday() {
  return format(new Date(), "yyyy-MM-dd")
}

// A date that changes rolls vertically: the old text leaves upward while the
// new one enters from below, like a counter ticking over. `popLayout` frees
// the leaving text's slot at once so the button never widens mid-swap.
function RollingText({ text, reduceMotion }: { text: string; reduceMotion: boolean }) {
  return (
    <span className="relative inline-grid overflow-hidden leading-4">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={text}
          className="col-start-1 row-start-1 whitespace-nowrap"
          initial={reduceMotion ? false : { y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { y: -10, opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.18, ease: EASE_OUT }}
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card size="sm" className="gap-1 rounded-lg shadow-none [--card-spacing:--spacing(3)]">
      <p className="px-(--card-spacing) text-xs text-muted-foreground">{label}</p>
      <p key={value} className={cn("px-(--card-spacing) text-xl font-semibold leading-tight tabular-nums", VALUE_CLASS_NAME)}>
        {value}
      </p>
      <p key={detail} className={cn("min-h-4 px-(--card-spacing) text-[11px] leading-4 text-muted-foreground tabular-nums", VALUE_CLASS_NAME)}>
        {detail}
      </p>
    </Card>
  )
}

export function UsageOverviewCards() {
  const { t, i18n } = useTranslation()
  const zh = i18n.language.startsWith("zh")
  const locale = zh ? zhCN : enUS
  const titleId = useId()
  const reduceMotion = Boolean(useReducedMotion())
  const today = useMemo(localToday, [])
  const [range, setRange] = useState<LocalDateRange>(() => presetRange(DEFAULT_PRESET, today))
  const preset = matchingPreset(range, today)
  const summary = useUsageRange(range)

  const fromDate = parseISO(range.from)
  const toDate = parseISO(range.to)
  const todayDate = parseISO(today)
  const dayLabel = (date: string) => format(parseISO(date), zh ? "yyyy年M月d日" : "MMM d, yyyy", { locale })
  const shortDay = (date: string) => format(parseISO(date), zh ? "M月d日" : "MMM d", { locale })
  const none = t("usage.overview.none")

  const cards = (() => {
    const data: UsageRangeSummary | null = summary.data
    if (!data) {
      return (["tokens", "projects", "sessions", "runs", "peakDay", "longestStreak"] as const).map((key) => ({
        key, value: none, detail: "",
      }))
    }
    const cost = data.costUsd === null
      ? t("usage.overview.noCost")
      : `$${data.costUsd.toFixed(2)}${data.runsWithoutCost > 0 ? ` · ${t("usage.overview.partialCost", { count: data.runsWithoutCost })}` : ""}`
    return [
      { key: "tokens", value: formatTokenCount(data.processedTokens), detail: cost },
      { key: "projects", value: data.projects.toLocaleString(), detail: "" },
      { key: "sessions", value: data.activeSessions.toLocaleString(), detail: t("usage.overview.activeDays", { count: data.activeDays }) },
      {
        key: "runs", value: data.runs.toLocaleString(),
        detail: data.runs === 0 ? "" : t("usage.overview.completedShare", { percent: Math.round((data.completed / data.runs) * 100) }),
      },
      {
        key: "peakDay",
        value: data.peakDay ? formatTokenCount(data.peakDay.processedTokens) : none,
        detail: data.peakDay ? dayLabel(data.peakDay.date) : "",
      },
      {
        key: "longestStreak",
        value: data.longestStreak ? t("usage.overview.streakDays", { count: data.longestStreak.days }) : none,
        detail: data.longestStreak ? `${shortDay(data.longestStreak.from)} – ${shortDay(data.longestStreak.to)}` : "",
      },
    ] as const
  })()

  const pickerTrigger = (label: string) => ({ value, setOpen }: { value: Date | undefined; setOpen: (open: boolean) => void }) => (
    <Button
      variant="outline"
      size="xs"
      // Fixed width with room to spare: "2026年12月31日" and "Sep 1, 2026"
      // must not resize the row when the range changes.
      className="w-32 justify-center overflow-hidden tabular-nums"
      aria-label={label}
      onClick={() => setOpen(true)}
    >
      <RollingText text={value ? dayLabel(format(value, "yyyy-MM-dd")) : none} reduceMotion={reduceMotion} />
    </Button>
  )

  return (
    <section
      aria-labelledby={titleId}
      className="mx-auto flex w-full flex-col gap-3"
      style={{ maxWidth: USAGE_HEATMAP_WIDTH }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pr-[3px]">
        <h2 id={titleId} className="text-sm font-semibold">
          {t("usage.overview.title")}
        </h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Tabs
            value={preset === null ? CUSTOM_RANGE : String(preset)}
            onValueChange={(value) => {
              if (isPreset(value)) setRange(presetRange(Number(value) as RangePreset, today))
            }}
            className="gap-0"
          >
            <TabsList variant="text" size="sm" aria-label={t("usage.overview.rangeLabel")} className="h-7">
              {RANGE_PRESETS.map((days) => (
                <TabsTrigger key={days} value={String(days)} className="text-xs">
                  {t(`usage.overview.presets.${days}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {/* The pickers always mirror the active range, so a preset shows its
              exact dates and editing either end turns the range custom. */}
          <div className="flex items-center gap-1.5">
            <DateTimePicker
              hideTime
              locale={locale}
              value={fromDate}
              max={toDate}
              doneLabel={t("usage.overview.done")}
              onChange={(date) => {
                if (date) setRange({ from: format(date, "yyyy-MM-dd"), to: range.to })
              }}
              renderTrigger={pickerTrigger(t("usage.overview.from"))}
            />
            <span aria-hidden className="text-xs text-muted-foreground">–</span>
            <DateTimePicker
              hideTime
              locale={locale}
              value={toDate}
              min={fromDate}
              max={todayDate}
              doneLabel={t("usage.overview.done")}
              onChange={(date) => {
                if (date) setRange({ from: range.from, to: format(date, "yyyy-MM-dd") })
              }}
              renderTrigger={pickerTrigger(t("usage.overview.to"))}
            />
          </div>
        </div>
      </div>
      {summary.error ? (
        <div role="alert" className="flex items-center gap-3 text-sm">
          <p className="break-words text-destructive">{summary.error}</p>
          <Button variant="outline" size="xs" onClick={summary.retry}>
            {t("usage.retry")}
          </Button>
        </div>
      ) : null}
      <div
        aria-busy={summary.loading || undefined}
        className={cn(
          "grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6",
          "motion-safe:transition-opacity motion-safe:duration-150",
          summary.loading && summary.data ? "opacity-60" : "opacity-100"
        )}
      >
        {cards.map((card) => (
          <StatCard key={card.key} label={t(`usage.overview.cards.${card.key}`)} value={card.value} detail={card.detail} />
        ))}
      </div>
    </section>
  )
}
