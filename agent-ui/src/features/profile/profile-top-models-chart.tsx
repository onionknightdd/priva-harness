import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Bar, BarChart, Cell, XAxis, YAxis } from "recharts"

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

import { mockTopModels } from "./mock-profile-data"

const modelColors = {
  gpt4o: "oklch(0.546 0.215 262.88)",
  claude: "oklch(0.623 0.188 259.81)",
  gemini: "oklch(0.685 0.148 237.32)",
  other: "oklch(0.828 0.093 230.32)",
} as const

const chartConfig = {
  share: {
    label: "Share",
  },
  gpt4o: {
    label: "gpt-4o",
    color: modelColors.gpt4o,
  },
  claude: {
    label: "claude-3.5-sonnet",
    color: modelColors.claude,
  },
  gemini: {
    label: "gemini-1.5-pro",
    color: modelColors.gemini,
  },
  other: {
    label: "Others",
    color: modelColors.other,
  },
} satisfies ChartConfig

export function ProfileTopModelsChart() {
  const { t } = useTranslation()
  const chartData = useMemo(
    () =>
      mockTopModels.map((model) => ({
        model: model.id,
        share: model.share,
        fill: model.fill,
      })),
    []
  )

  return (
    <ChartContainer
      config={{
        ...chartConfig,
        share: { label: t("profile.share") },
        other: { ...chartConfig.other, label: t("profile.models.other") },
      }}
      className="aspect-auto h-[180px] w-full"
    >
      <BarChart
        accessibilityLayer
        data={chartData}
        layout="vertical"
        margin={{ left: 4, right: 12 }}
      >
        <YAxis
          dataKey="model"
          type="category"
          tickLine={false}
          tickMargin={8}
          axisLine={false}
          width={104}
          tickFormatter={(value) => {
            if (value === "other") {
              return t("profile.models.other")
            }

            return chartConfig[value as keyof typeof chartConfig]?.label ?? value
          }}
        />
        <XAxis dataKey="share" type="number" hide />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent hideLabel nameKey="model" />}
        />
        <Bar
          dataKey="share"
          radius={4}
          barSize={16}
          isAnimationActive={false}
          activeBar={false}
        >
          {chartData.map((entry) => (
            <Cell
              key={entry.model}
              fill={modelColors[entry.model as keyof typeof modelColors]}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
