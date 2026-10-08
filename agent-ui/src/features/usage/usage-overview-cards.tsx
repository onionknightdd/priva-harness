import { format, parseISO } from "date-fns"
import { enUS, zhCN } from "date-fns/locale"
import { useId, useMemo, useState, type CSSProperties } from "react"
import { useTranslation } from "react-i18next"

import { Tabs, TabsList, TabsTrigger } from "@/components/assistant-ui/tabs"
import { DateRangePickerDropdown, type DateRange } from "@/components/motion/date-range-picker"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { formatTokenCount } from "@/features/agent-message/context-usage"
import { cn } from "@/lib/utils"

import {
  cacheHitRate,
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
const CARD_KEYS = ["tokens", "cacheHitRate", "sessions", "peakDay", "longestStreak"] as const
type CardKey = (typeof CARD_KEYS)[number]

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

// Card text wraps on narrow cards. Each segment between separators is an
// inline-block, so the line breaks at a separator and keeps a figure with its
// unit; a segment only wraps internally when it is wider than the card. The
// separators themselves stay as plain text between the blocks, since a space
// inside an inline-block would collapse.
//   detail: " · " and " – "
//   value:  the comma joining two figures ("173，共计 519 轮" / "173, 519 turns");
//           a thousands separator ("1,234") has no space after it and is kept.
const DETAIL_SEPARATOR = /( · | – )/
const VALUE_SEPARATOR = /((?<=，)|(?<=,) )/

function segments(text: string, separator: RegExp) {
  return text.split(separator).map((segment, index) =>
    index % 2 === 1 ? segment : <span key={index} className="inline-block">{segment}</span>
  )
}

type StatCardProps = { label: string; value: string; detail: string }

function StatCard({ label, value, detail }: StatCardProps) {
  return (
    // Inline so the 12px spacing beats Card's own size variants for certain.
    <Card size="sm" className="gap-1 rounded-lg shadow-none" style={{ "--card-spacing": "0.75rem" } as CSSProperties}>
      <p className="px-(--card-spacing) text-xs text-muted-foreground">{label}</p>
      <p key={value} className={cn("px-(--card-spacing) text-xl font-semibold leading-tight tabular-nums", VALUE_CLASS_NAME)}>
        {segments(value, VALUE_SEPARATOR)}
      </p>
      {/* Detail rows sit on one baseline across the row even when a value
          wraps, so the value area absorbs the extra line. */}
      <p key={detail} className={cn("mt-auto min-h-4 px-(--card-spacing) text-[11px] leading-4 text-muted-foreground tabular-nums", VALUE_CLASS_NAME)}>
        {segments(detail, DETAIL_SEPARATOR)}
      </p>
    </Card>
  )
}

export function UsageOverviewCards() {
  const { t, i18n } = useTranslation()
  const zh = i18n.language.startsWith("zh")
  const locale = zh ? zhCN : enUS
  const titleId = useId()
  const today = useMemo(localToday, [])
  const [range, setRange] = useState<LocalDateRange>(() => presetRange(DEFAULT_PRESET, today))
  const [rangeOpen, setRangeOpen] = useState(false)
  const [draftRange, setDraftRange] = useState<DateRange | null>(range)
  // Which tab is lit is derived from the dates: selecting a range
  // no preset covers moves the highlight to 「自定义区间」 by itself. Choosing
  // that tab explicitly keeps it lit even while the dates still equal a preset,
  // so the user can start editing from the current range.
  const [customChosen, setCustomChosen] = useState(false)
  const preset = matchingPreset(range, today)
  const activeTab = customChosen || preset === null ? CUSTOM_RANGE : String(preset)
  const summary = useUsageRange(range)

  const dayLabel = (date: string) => format(parseISO(date), zh ? "yyyy年M月d日" : "MMM d, yyyy", { locale })
  const shortDay = (date: string) => format(parseISO(date), zh ? "M月d日" : "MMM d", { locale })
  const none = t("usage.overview.none")

  const cards = ((): (Omit<StatCardProps, "label"> & { key: CardKey })[] => {
    const data: UsageRangeSummary | null = summary.data
    if (!data) {
      return CARD_KEYS.map((key) => ({ key, value: none, detail: "" }))
    }
    const cost = data.costUsd === null
      ? t("usage.overview.noCost")
      : `$${data.costUsd.toFixed(2)}${data.runsWithoutCost > 0 ? ` · ${t("usage.overview.partialCost", { count: data.runsWithoutCost })}` : ""}`
    const hitRate = cacheHitRate(data)
    return [
      { key: "tokens", value: formatTokenCount(data.processedTokens), detail: cost },
      {
        key: "cacheHitRate",
        value: hitRate === null ? none : `${Math.round(hitRate * 100)}%`,
        detail: hitRate === null ? "" : t("usage.overview.cacheTokens", {
          read: formatTokenCount(data.cacheReadTokens), write: formatTokenCount(data.cacheWriteTokens),
        }),
      },
      {
        key: "sessions",
        value: `${data.activeSessions.toLocaleString()}${t("usage.overview.sessionTurns", { count: data.runs })}`,
        detail: t("usage.overview.sessionDetail", { days: data.activeDays, projects: data.projects }),
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
    ]
  })()

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
            value={activeTab}
            onValueChange={(value) => {
              if (isPreset(value)) {
                setRange(presetRange(Number(value) as RangePreset, today))
                setCustomChosen(false)
              } else if (value === CUSTOM_RANGE) {
                setCustomChosen(true)
              }
            }}
            className="gap-0"
          >
            <TabsList variant="text" size="sm" aria-label={t("usage.overview.rangeLabel")} className="h-7">
              {RANGE_PRESETS.map((days) => (
                <TabsTrigger key={days} value={String(days)} className="text-xs">
                  {t(`usage.overview.presets.${days}`)}
                </TabsTrigger>
              ))}
              <TabsTrigger value={CUSTOM_RANGE} className="text-xs">
                {t("usage.overview.presets.custom")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <DateRangePickerDropdown
            value={rangeOpen ? draftRange : range}
            open={rangeOpen}
            onOpenChange={(open) => {
              if (open) setDraftRange(range)
              setRangeOpen(open)
            }}
            onValueChange={(next) => {
              setDraftRange(next)
              // A partial selection stays in the calendar until both endpoints
              // are chosen; dismissing it keeps the last applied statistics.
              if (next?.to) setRange({ from: next.from, to: next.to })
            }}
            max={today}
            locale={zh ? "zh-CN" : "en-US"}
            label={t("usage.overview.rangeLabel")}
            closeOnSelect
            showSummary
          />
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
          "grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5",
          "motion-safe:transition-opacity motion-safe:duration-150",
          summary.loading && summary.data ? "opacity-60" : "opacity-100"
        )}
      >
        {cards.map(({ key, ...card }) => (
          <StatCard key={key} label={t(`usage.overview.cards.${key}`)} {...card} />
        ))}
      </div>
    </section>
  )
}
