import { format, parseISO } from "date-fns"
import { enUS, zhCN } from "date-fns/locale"
import { useReducedMotion } from "motion/react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

import {
  modelSeries,
  OTHER_MODELS_KEY,
  type UsageDailyModels,
  type UsageDay,
  type UsageModel,
} from "./usage-api"
import { seriesColor } from "./usage-series-colors"

// Series are addressed by position rather than by model name: model ids can
// contain "." and "/", which are not valid inside the CSS custom property the
// chart container derives from each config key.
const seriesKey = (index: number) => `series${index + 1}`

// Bars grow from the baseline when the chart appears; Recharts' 1.5s default
// reads as sluggish, so the reveal is kept close to the heatmap's.
const BAR_REVEAL_MS = 320


export function UsageModelChart({
  window,
  dailyModels,
  models,
}: {
  window: readonly UsageDay[]
  dailyModels: readonly UsageDailyModels[]
  models: readonly UsageModel[]
}) {
  const { t, i18n } = useTranslation()
  const zh = i18n.language.startsWith("zh")
  const locale = zh ? zhCN : enUS
  const reduceMotion = Boolean(useReducedMotion())
  const series = useMemo(() => modelSeries(window, dailyModels, models), [window, dailyModels, models])

  const config = useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        series.keys.map((model, index) => [
          seriesKey(index),
          {
            label: model === OTHER_MODELS_KEY ? t("usage.models.other") : model,
            color: seriesColor(index),
          },
        ])
      ),
    [series.keys, t]
  )
  const rows = useMemo(
    () =>
      series.months.map((month) => ({
        month: month.month,
        ...Object.fromEntries(series.keys.map((model, index) => [seriesKey(index), month.byModel[model] ?? 0])),
      })),
    [series]
  )
  const monthTick = (value: string) => format(parseISO(value), "LLL", { locale })
  const monthLabel = (value: string) => format(parseISO(value), zh ? "yyyy年M月" : "MMM yyyy", { locale })

  if (series.keys.length === 0) {
    return (
      <p
        className="flex h-[168px] items-center justify-center text-sm text-muted-foreground"
      >
        {t("usage.models.empty")}
      </p>
    )
  }

  return (
    <ChartContainer
      config={config}
      className="aspect-auto h-[168px] w-full"
    >
      <BarChart accessibilityLayer data={rows} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} tickMargin={8} axisLine={false} tickFormatter={monthTick} />
        <ChartTooltip
          content={<ChartTooltipContent labelFormatter={(value) => monthLabel(String(value))} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        {series.keys.map((_, index) => (
          <Bar
            key={seriesKey(index)}
            dataKey={seriesKey(index)}
            stackId="models"
            fill={`var(--color-${seriesKey(index)})`}
            radius={index === series.keys.length - 1 ? [3, 3, 0, 0] : 0}
            isAnimationActive={!reduceMotion}
            animationDuration={BAR_REVEAL_MS}
            animationEasing="ease-out"
          />
        ))}
      </BarChart>
    </ChartContainer>
  )
}
