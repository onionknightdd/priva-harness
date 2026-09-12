import { enUS, zhCN } from "date-fns/locale"
import { useId, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { Tabs, TabsList, TabsTrigger } from "@/components/assistant-ui/tabs"
import {
  CalendarHeatmap,
  CalendarHeatmapBlock,
  CalendarHeatmapBody,
} from "@/components/heatmap/calendar-heatmap"

import {
  HEATMAP_MODES,
  heatmapActivities,
  type HeatmapMode,
  type UsageDay,
} from "./usage-api"

// Registry defaults (12px cells, 4px gutter): 53 weeks fit in 844px, so a
// full year sits inside the content column on a laptop and scrolls below that.
export const USAGE_HEATMAP_BLOCK_SIZE = 12
export const USAGE_HEATMAP_BLOCK_MARGIN = 4

// Mode switches re-colour every cell at once; a short fill transition reads
// as one grid changing rather than a repaint.
const CELL_CLASS_NAME =
  "motion-safe:transition-[fill,opacity] motion-safe:duration-200 motion-safe:ease-out"

function isHeatmapMode(value: unknown): value is HeatmapMode {
  return typeof value === "string" && (HEATMAP_MODES as readonly string[]).includes(value)
}

export function UsageHeatmap({ days }: { days: readonly UsageDay[] }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language.startsWith("zh") ? zhCN : enUS
  const [mode, setMode] = useState<HeatmapMode>("daily")
  const data = useMemo(() => heatmapActivities(days, mode), [days, mode])
  const titleId = useId()

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h2 id={titleId} className="text-sm font-semibold">
          {t("usage.heatmap.title")}
        </h2>
        <Tabs
          value={mode}
          onValueChange={(value) => {
            if (isHeatmapMode(value)) setMode(value)
          }}
          className="gap-0"
        >
          <TabsList
            variant="ghost"
            size="sm"
            aria-label={t("usage.heatmap.modeLabel")}
            className="h-7 bg-transparent"
          >
            {HEATMAP_MODES.map((value) => (
              <TabsTrigger key={value} value={value} className="text-xs">
                {t(`usage.heatmap.mode.${value}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
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
          cellLabel: t(`usage.heatmap.cellLabel.${mode}`),
          heatmapLabel: t("usage.heatmap.ariaLabel"),
        }}
        aria-labelledby={titleId}
        className="w-full max-w-full gap-0 p-0"
      >
        <CalendarHeatmapBody
          hideWeekdayLabels
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
    </div>
  )
}
