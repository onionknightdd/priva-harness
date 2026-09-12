import { format, parseISO } from "date-fns"
import { enUS, zhCN } from "date-fns/locale"
import { useReducedMotion } from "motion/react"
import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import { useTranslation } from "react-i18next"

import {
  CalendarHeatmap,
  CalendarHeatmapBlock,
  CalendarHeatmapBody,
} from "@/components/heatmap/calendar-heatmap"
import { Tooltip, TooltipContent } from "@/components/ui/tooltip"
import { EASE_OUT_CSS } from "@/lib/ease"

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

// Month labels stay at 12px; weekday labels sit one step smaller.
const WEEKDAY_LABEL_FONT_SIZE = 11

// Mode switches re-colour every cell at once; a short fill transition reads
// as one grid changing rather than a repaint. `transform-box: fill-box` lets
// the reveal scale each cell about its own centre instead of the SVG origin.
const CELL_CLASS_NAME =
  "origin-center [transform-box:fill-box] motion-safe:transition-[fill,opacity] motion-safe:duration-200 motion-safe:ease-out"

// Sunday first: the component indexes weekday labels from Sunday and rotates
// them by `weekStart`.
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const

type HoveredCell = { element: SVGRectElement; date: string; value: number }

function cellFromEvent(event: MouseEvent<HTMLElement>): HoveredCell | null {
  const target = event.target as Element | null
  const rect = target?.closest<SVGRectElement>("rect[data-date]")
  if (!rect?.dataset.date) return null
  return { element: rect, date: rect.dataset.date, value: Number(rect.dataset.value) }
}

export function UsageHeatmap({
  days,
  mode,
}: {
  days: readonly UsageDay[]
  mode: HeatmapMode
}) {
  const { t, i18n } = useTranslation()
  const zh = i18n.language.startsWith("zh")
  const locale = zh ? zhCN : enUS
  const reduceMotion = Boolean(useReducedMotion())
  const rootRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState<HoveredCell | null>(null)
  const data = useMemo(() => heatmapActivities(days, mode), [days, mode])
  const weekdays = useMemo(
    () => WEEKDAY_KEYS.map((key) => t(`usage.heatmap.weekday.${key}`)),
    [t]
  )

  // Reveal the year left to right when the data arrives: cells scale up from
  // their centre with a per-column delay, so the grid fills like a timeline
  // instead of popping in. Plain WAAPI keeps 365 concurrent animations off the
  // main thread, and `fill: "backwards"` hides each cell through its delay
  // while leaving no inline styles behind once it has played. Mode switches
  // only re-colour and do not replay.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || reduceMotion) return
    const cells = Array.from(root.querySelectorAll<SVGRectElement>("rect[data-date]"))
    const animations = cells.map((cell, index) =>
      cell.animate(
        [
          { opacity: 0, transform: "scale(0.62)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        {
          duration: 240,
          // The DOM is column-major (each week holds its seven days).
          delay: Math.floor(index / 7) * 15,
          easing: EASE_OUT_CSS,
          fill: "backwards",
        }
      )
    )
    return () => {
      for (const animation of animations) animation.cancel()
    }
  }, [days, reduceMotion])

  // The grid is memoised so hover state changes only re-render the tooltip,
  // not 365 cells.
  const grid = useMemo(
    () => (
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
          weekdayLabelFontSize={WEEKDAY_LABEL_FONT_SIZE}
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
    ),
    [data, locale, mode, t, weekdays]
  )

  // Crossing the 4px gutter between cells must not close and reopen the
  // tooltip; clearing waits a beat and the next cell cancels it.
  const clearTimer = useRef<number | null>(null)
  const cancelClear = () => {
    if (clearTimer.current !== null) window.clearTimeout(clearTimer.current)
    clearTimer.current = null
  }
  useLayoutEffect(() => cancelClear, [])

  return (
    <div
      ref={rootRef}
      onMouseOver={(event) => {
        const cell = cellFromEvent(event)
        if (!cell) return
        cancelClear()
        setHovered((current) => (current?.element === cell.element ? current : cell))
      }}
      onMouseOut={(event) => {
        if (!cellFromEvent(event)) return
        cancelClear()
        clearTimer.current = window.setTimeout(() => setHovered(null), 80)
      }}
    >
      {grid}
      {/* One tooltip follows the hovered cell; 365 individual triggers would
          be wasteful and would each wait on the shared hover delay. */}
      <Tooltip open={hovered !== null}>
        {hovered ? (
          <TooltipContent anchor={hovered.element} sideOffset={6} className="flex-col items-start gap-0.5">
            <span className="font-medium">
              {format(parseISO(hovered.date), zh ? "yyyy年M月d日" : "MMM d, yyyy", { locale })}
            </span>
            <span className="tabular-nums text-background/80">
              {t(`usage.heatmap.tooltip.${mode}`, { value: hovered.value.toLocaleString() })}
            </span>
          </TooltipContent>
        ) : null}
      </Tooltip>
    </div>
  )
}
