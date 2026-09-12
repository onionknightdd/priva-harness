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

import { heatmapActivities, type UsageDay } from "./usage-api"

// 11px cells with a 3px gutter: 53 weeks fit in 742px, so a full year sits
// inside the content column on a laptop and scrolls horizontally below that.
export const USAGE_HEATMAP_BLOCK_SIZE = 11
export const USAGE_HEATMAP_BLOCK_MARGIN = 3

export function UsageHeatmap({ days }: { days: readonly UsageDay[] }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language.startsWith("zh") ? zhCN : enUS
  const data = useMemo(() => heatmapActivities(days), [days])

  return (
    <CalendarHeatmap
      data={data}
      locale={locale}
      weekStart={1}
      blockSize={USAGE_HEATMAP_BLOCK_SIZE}
      blockMargin={USAGE_HEATMAP_BLOCK_MARGIN}
      blockRadius={2}
      fontSize={11}
      colors={{
        empty: "var(--color-muted)",
        scale: "var(--color-heatmap)",
      }}
      labels={{
        cellLabel: t("usage.heatmap.cellLabel"),
        heatmapLabel: t("usage.heatmap.ariaLabel"),
        legendLabel: t("usage.heatmap.legendLabel"),
        legendLevelLabel: t("usage.heatmap.legendLevelLabel"),
      }}
      className="w-full max-w-full gap-2 p-0"
    >
      <CalendarHeatmapBody
        hideWeekdayLabels
        hideYearLabels
        className="py-0"
        labelClassName="fill-muted-foreground"
      >
        {({ activity, dayIndex, weekIndex }) => (
          <CalendarHeatmapBlock
            activity={activity}
            dayIndex={dayIndex}
            weekIndex={weekIndex}
          />
        )}
      </CalendarHeatmapBody>
      <CalendarHeatmapFooter className="w-full items-center">
        <CalendarHeatmapLegend
          className="ml-0 text-xs"
          labels={{
            less: t("usage.heatmap.less"),
            more: t("usage.heatmap.more"),
          }}
        />
      </CalendarHeatmapFooter>
    </CalendarHeatmap>
  )
}
