import { format, parseISO } from "date-fns"
import { enUS, zhCN } from "date-fns/locale"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import {
  CalendarHeatmap,
  CalendarHeatmapBlock,
  CalendarHeatmapBody,
  CalendarHeatmapFooter,
  CalendarHeatmapLegend,
} from "@/components/heatmap/calendar-heatmap"

import {
  createMockHeatmapData,
  getHeatmapPeak,
  type ProfileRangeWeeks,
} from "./mock-profile-data"

function formatTokenCount(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`
  }

  return String(value)
}

export function ProfileTokenHeatmap({ weeks }: { weeks: ProfileRangeWeeks }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language.startsWith("zh") ? zhCN : enUS
  const data = useMemo(() => createMockHeatmapData(weeks), [weeks])
  const peak = getHeatmapPeak(data)

  return (
    <CalendarHeatmap
      data={data}
      locale={locale}
      weekStart={1}
      blockSize={11}
      blockMargin={3}
      blockRadius={2}
      fontSize={11}
      colors={{
        empty: "var(--color-muted)",
        scale: "oklch(0.623 0.188 259.81)",
      }}
      labels={{
        cellLabel: t("profile.heatmap.cellLabel"),
        heatmapLabel: t("profile.heatmap.ariaLabel"),
        legendLabel: t("profile.heatmap.legendLabel"),
        legendLevelLabel: t("profile.heatmap.legendLevelLabel"),
      }}
      className="w-full max-w-full gap-3 p-0"
    >
      <CalendarHeatmapBody
        hideWeekdayLabels
        hideYearLabels
        className="py-1"
      >
        {({ activity, dayIndex, weekIndex }) => (
          <CalendarHeatmapBlock
            activity={activity}
            dayIndex={dayIndex}
            weekIndex={weekIndex}
          />
        )}
      </CalendarHeatmapBody>
      <CalendarHeatmapFooter className="w-full items-end justify-between gap-4">
        <CalendarHeatmapLegend
          className="ml-0 text-xs"
          labels={{
            less: t("profile.heatmap.less"),
            more: t("profile.heatmap.more"),
          }}
        />
        <div className="flex flex-wrap gap-6 text-right">
          <div className="space-y-0.5">
            <p className="text-[11px] text-muted-foreground">
              {t("profile.heatmap.peakUsage")}
            </p>
            <p className="text-sm font-medium tabular-nums">
              {formatTokenCount(peak.value)} {t("profile.tokens")}
            </p>
            {peak.date ? (
              <p className="text-[11px] text-muted-foreground">
                {format(
                  parseISO(peak.date),
                  i18n.language.startsWith("zh") ? "yyyy年M月d日" : "MMM d, yyyy",
                  { locale }
                )}
              </p>
            ) : null}
          </div>
          <div className="space-y-0.5">
            <p className="text-[11px] text-muted-foreground">
              {t("profile.heatmap.weeklyTrend")}
            </p>
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              +15.2%
            </p>
            <p className="text-[11px] text-muted-foreground">
              {t("profile.heatmap.vsPrevious")}
            </p>
          </div>
        </div>
      </CalendarHeatmapFooter>
    </CalendarHeatmap>
  )
}
