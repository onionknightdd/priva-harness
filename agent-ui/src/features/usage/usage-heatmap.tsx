import { enUS, zhCN } from "date-fns/locale"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import {
  CalendarHeatmap,
  CalendarHeatmapBlock,
  CalendarHeatmapBody,
} from "@/components/heatmap/calendar-heatmap"

import { heatmapActivities, type HeatmapMode, type UsageDay } from "./usage-api"

// Registry defaults (12px cells, 4px gutter). A rolling 365 days always spans
// 53 Monday-start columns, so the strip has a fixed width the surrounding
// block can adopt: weekday labels + grid + the SVG's stroke padding.
export const USAGE_HEATMAP_BLOCK_SIZE = 12
export const USAGE_HEATMAP_BLOCK_MARGIN = 4
const WEEK_COLUMNS = 53
const WEEKDAY_LABEL_WIDTH = 40
const STROKE_PADDING = 3
export const USAGE_HEATMAP_WIDTH =
  WEEKDAY_LABEL_WIDTH +
  WEEK_COLUMNS * (USAGE_HEATMAP_BLOCK_SIZE + USAGE_HEATMAP_BLOCK_MARGIN) -
  USAGE_HEATMAP_BLOCK_MARGIN +
  STROKE_PADDING * 2

// Mode switches re-colour every cell at once; a short fill transition reads
// as one grid changing rather than a repaint.
const CELL_CLASS_NAME =
  "motion-safe:transition-[fill,opacity] motion-safe:duration-200 motion-safe:ease-out"

// Sunday first: the component indexes weekday labels from Sunday and rotates
// them by `weekStart`.
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const

export function UsageHeatmap({
  days,
  mode,
}: {
  days: readonly UsageDay[]
  mode: HeatmapMode
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language.startsWith("zh") ? zhCN : enUS
  const data = useMemo(() => heatmapActivities(days, mode), [days, mode])
  const weekdays = useMemo(
    () => WEEKDAY_KEYS.map((key) => t(`usage.heatmap.weekday.${key}`)),
    [t]
  )

  return (
    <CalendarHeatmap
      data={data}
      locale={locale}
      weekStart={1}
      splitYears={false}
      blockSize={USAGE_HEATMAP_BLOCK_SIZE}
      blockMargin={USAGE_HEATMAP_BLOCK_MARGIN}
      blockRadius={3}
      fontSize={16}
      monthLabelPosition="bottom"
      colors={{
        empty: "var(--color-muted)",
        scale: "var(--color-heatmap)",
      }}
      labels={{
        weekdays,
        cellLabel: t(`usage.heatmap.cellLabel.${mode}`),
        heatmapLabel: t("usage.heatmap.ariaLabel"),
      }}
      className="w-max max-w-full gap-0 p-0"
    >
      <CalendarHeatmapBody
        hideYearLabels
        className="py-0"
        labelClassName="font-sans fill-muted-foreground"
      >
        {({ activity, dayIndex, weekIndex }) => (
          <CalendarHeatmapBlock
            activity={activity}
            dayIndex={dayIndex}
            weekIndex={weekIndex}
            className={CELL_CLASS_NAME}
          />
        )}
      </CalendarHeatmapBody>
    </CalendarHeatmap>
  )
}
