import "./disable-devtools"

/* oxlint-disable react/only-export-components -- this module exports libraries, not page components */

import {
  action,
  createLibrary,
  defineComponent,
  Renderer,
  useIsStreaming,
  useTriggerAction,
  type ComponentGroup,
} from "@openuidev/react-lang"
import { Button as OpenUiButton } from "@openuidev/react-ui/Button"
import { Card as OpenUiCard } from "@openuidev/react-ui/Card"
import { CardHeader as OpenUiCardHeader } from "@openuidev/react-ui/CardHeader"
import { Tag } from "@openuidev/react-ui/Tag"
import { useTheme, type Theme } from "@openuidev/react-ui/ThemeProvider"

export { Renderer }
import { useReducedMotion } from "motion/react"
import { useMemo, type ReactNode } from "react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, XAxis, YAxis } from "recharts"
import { z } from "zod/v4"

import {
  DonutChart as BeuiDonutChart,
  DonutChartCenter,
  DonutChartLegend,
  DonutChartPlot,
} from "@/components/charts/donut-chart"
import {
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { cn } from "@/lib/utils"
import { ViewportChartContainer } from "./viewport-chart-container"

const gapClass = {
  none: "gap-0",
  xs: "gap-1",
  s: "gap-2",
  m: "gap-3",
  l: "gap-4",
  xl: "gap-6",
  "2xl": "gap-8",
} as const

const alignClass = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
  baseline: "items-baseline",
} as const

const justifyClass = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
  around: "justify-around",
  evenly: "justify-evenly",
} as const

const textClass = {
  small: "text-xs",
  body: "text-sm",
  large: "text-base font-medium",
} as const

const textColor = {
  small: "var(--openui-text-neutral-secondary)",
  body: "var(--openui-text-neutral-primary)",
  large: "var(--openui-text-neutral-primary)",
} as const

const badgeTone = {
  neutral: "neutral",
  info: "info",
  success: "success",
  warning: "warning",
  danger: "danger",
} as const

type Gap = keyof typeof gapClass
type Align = keyof typeof alignClass
type Justify = keyof typeof justifyClass
type TextSize = keyof typeof textClass
type BadgeTone = keyof typeof badgeTone

// OpenUI's chart floor (`OCEAN_DEFAULT` in react-ui). Used when the active
// theme does not set `barChartPalette`, `lineChartPalette`, or `defaultChartPalette`.
const openUiChartFloor = [
  "#0D47A1",
  "#1565C0",
  "#1976D2",
  "#1E88E5",
  "#2196F3",
  "#42A5F5",
  "#64B5F6",
  "#90CAF9",
  "#BBDEFB",
  "#E3F2FD",
  "#EFF8FF",
] as const

// Colors painted on the BeUI donut chart example, in legend order.
const beuiDonutPalette = ["#2563eb", "#38bdf8", "#0d9488", "#fbbf24"] as const

// shadcn's chart docs color series with --chart-1 through --chart-5. This app's
// tokens are gray, so the area chart uses the multi-hue palette from those docs.
const shadcnAreaPalette = [
  "oklch(0.646 0.222 41.116)",
  "oklch(0.6 0.118 184.704)",
  "oklch(0.398 0.07 227.392)",
  "oklch(0.828 0.189 84.429)",
  "oklch(0.769 0.188 70.08)",
] as const

const chartInk = "var(--openui-text-neutral-secondary)"
const axisStyle = { color: chartInk }
const axisTick = { fill: chartInk, fontSize: 12 }
const chartMargin = { top: 20, right: 12, left: 12, bottom: 0 }

function endLabelGutter(rows: readonly Record<string, string | number>[], count: number): number {
  let longest = 1
  for (const row of rows) {
    for (let index = 0; index < count; index += 1) {
      const value = row[`s${index}`]
      if (typeof value === "number") longest = Math.max(longest, String(value).length)
    }
  }
  // End points keep a centered label inside the chart. A crowded label can also sit beside the point, so the gutter fits a whole label.
  return Math.max(28, longest * 8 + 8)
}

function chartValueLabel(dataKey: string) {
  return (
    <LabelList
      dataKey={dataKey}
      position="top"
      offset={6}
      fontSize={11}
      fill={chartInk}
      className="tabular-nums"
    />
  )
}

type LabelBox = { left: number; right: number; top: number; bottom: number }

const lineLabelHeight = 14
const lineChartHeight = 192
const lineAxisTop = lineChartHeight - 28

function labelBoxesOverlap(a: LabelBox, b: LabelBox): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && b.top < a.bottom
}

function lineValueLabels(dataKey: string, occupied: Map<string, LabelBox>) {
  return (
    <LabelList
      dataKey={dataKey}
      content={(props) => {
        const viewBox = props.viewBox
        if (viewBox == null || !("x" in viewBox) || !("y" in viewBox)) return <g />
        const { x, y } = viewBox
        const value = props.value
        const text = typeof value === "number" || typeof value === "string" ? String(value) : ""
        if (text === "") return <g />
        const width = text.length * 8
        const id = `${dataKey}:${props.index ?? x}`
        const places = [
          { x, baseline: y - 8 },
          { x: x - width / 2 - 10, baseline: y - 3 },
          { x: x + width / 2 + 10, baseline: y - 3 },
          { x, baseline: y + lineLabelHeight + 2 },
        ]
        occupied.delete(id)
        const taken = [...occupied.values()]
        const boxAt = (center: number, baseline: number): LabelBox => ({
          left: center - width / 2 - 2,
          right: center + width / 2 + 2,
          top: baseline - lineLabelHeight,
          bottom: baseline + 1,
        })
        const fits = (box: LabelBox) =>
          box.top >= 0 &&
          box.left >= 1 &&
          box.bottom <= lineAxisTop &&
          !taken.some((item) => labelBoxesOverlap(item, box))
        const side = places[1] ?? places[0]
        const chosen = places.map((place) => ({ place, box: boxAt(place.x, place.baseline) })).find((item) => fits(item.box))
          ?? { place: side, box: boxAt(side.x, side.baseline) }
        occupied.set(id, chosen.box)
        return (
          <text
            x={chosen.place.x}
            y={chosen.place.baseline}
            textAnchor="middle"
            fontSize={11}
            fill={chartInk}
            className="tabular-nums"
          >
            {text}
          </text>
        )
      }}
    />
  )
}
const ruleStyle = { borderColor: "var(--openui-border-default)" }

interface ElementNode {
  typeName: string
  props: Record<string, unknown>
}

function elements(value: unknown): ElementNode[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return []
    const record = item as Record<string, unknown>
    const props = record.props
    if (typeof record.typeName !== "string" || typeof props !== "object" || props === null) {
      return []
    }
    return [{ typeName: record.typeName, props: props as Record<string, unknown> }]
  })
}

function textOf(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : ""
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function numberList(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : []
}

function namedChoice<T extends string>(value: unknown, choices: Record<T, string>, fallback: T): T {
  return typeof value === "string" && value in choices ? (value as T) : fallback
}

const Text = defineComponent({
  name: "Text",
  description: "One line of text. size is small, body, or large.",
  props: z.object({
    text: z.string(),
    size: z.enum(["small", "body", "large"]).optional(),
  }),
  component: ({ props }) => {
    const size = namedChoice<TextSize>(props.size, textClass, "body")
    return (
      <p
        data-slot="render-ui-text"
        data-size={size}
        className={textClass[size]}
        style={{ color: textColor[size] }}
      >
        {props.text}
      </p>
    )
  },
})

const BadgeBlock = defineComponent({
  name: "Badge",
  description: "Short status label. variant is neutral, info, success, warning, or danger.",
  props: z.object({
    text: z.string(),
    variant: z.enum(["neutral", "info", "success", "warning", "danger"]).optional(),
  }),
  component: ({ props }) => {
    const tone = namedChoice<BadgeTone>(props.variant, badgeTone, "neutral")
    return <Tag size="sm" text={props.text} variant={tone} />
  },
})

const CardHeaderBlock = defineComponent({
  name: "CardHeader",
  description: "Title and optional description for a section.",
  props: z.object({
    title: z.string(),
    description: z.string().optional(),
  }),
  component: ({ props }) => (
    <OpenUiCardHeader data-slot="render-ui-header" subtitle={props.description} title={props.title} />
  ),
})

const Col = defineComponent({
  name: "Col",
  description: "One table column. data is an array of strings or numbers, usually a reference.",
  props: z.object({
    label: z.string(),
    data: z.array(z.union([z.string(), z.number()])),
    type: z.enum(["string", "number"]).optional(),
  }),
  component: () => null,
})

const Table = defineComponent({
  name: "Table",
  description: "Table built from Col columns. Each column's data array is one cell per row.",
  props: z.object({
    columns: z.array(Col.ref),
  }),
  component: ({ props }) => {
    const columns = elements(props.columns).map((column) => {
      const data = column.props.data
      const cells = Array.isArray(data) ? data.map((item) => textOf(item)) : []
      const numeric =
        column.props.type === "number" ||
        (Array.isArray(data) && data.length > 0 && data.every((item) => typeof item === "number"))
      return { label: textOf(column.props.label), numeric, cells }
    })
    const rowCount = columns.reduce((count, column) => Math.max(count, column.cells.length), 0)
    return (
      <div className="overflow-x-auto" data-slot="render-ui-table">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left" style={{ ...ruleStyle, ...axisStyle }}>
              {columns.map((column, index) => (
                <th
                  key={`${column.label}-${index}`}
                  className={cn("py-1.5 pr-3 font-medium", column.numeric && "text-right")}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_, row) => (
              <tr key={row} className="border-b last:border-0" style={ruleStyle}>
                {columns.map((column, index) => (
                  <td
                    key={`${column.label}-${index}`}
                    className={cn("py-1.5 pr-3", column.numeric && "text-right tabular-nums")}
                  >
                    {column.cells[row] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  },
})

const Series = defineComponent({
  name: "Series",
  description: "Named numeric series. values align by index with the chart labels.",
  props: z.object({
    name: z.string(),
    values: z.array(z.number()),
  }),
  component: () => null,
})

function distributeColors(colors: readonly string[], count: number): string[] {
  const length = colors.length
  if (length === 0 || count <= 0) return []
  const mid = Math.floor(length / 2)
  const at = (index: number) => colors[((index % length) + length) % length] ?? colors[0] ?? ""
  if (count === 1) return [at(mid)]
  if (count === 2) return [at(Math.max(mid - 1, 0)), at(Math.min(mid + 1, length - 1))]
  const offset = Math.floor((count - 1) / 2)
  return Array.from({ length: count }, (_, index) => at(mid + (index - offset)))
}

function chartColors(theme: Theme, kind: "bar" | "line" | "area", count: number): string[] {
  if (kind === "area") {
    return Array.from(
      { length: count },
      (_, index) => shadcnAreaPalette[index % shadcnAreaPalette.length] ?? shadcnAreaPalette[0],
    )
  }
  const specific = kind === "bar" ? theme.barChartPalette : theme.lineChartPalette
  const source =
    specific && specific.length > 0
      ? specific
      : theme.defaultChartPalette && theme.defaultChartPalette.length > 0
        ? theme.defaultChartPalette
        : openUiChartFloor
  return distributeColors(source, count)
}

function chartModel(labels: unknown, series: unknown, colors: readonly string[]) {
  const names = stringList(labels)
  const items = elements(series)
  const values = items.map((item) => numberList(item.props.values))
  const config: ChartConfig = {}
  items.forEach((item, index) => {
    config[`s${index}`] = {
      label: textOf(item.props.name) || `Series ${index + 1}`,
      color: colors[index] ?? colors[0],
    }
  })
  const rows = names.map((label, index) => {
    const row: Record<string, string | number> = { label }
    items.forEach((item, seriesIndex) => {
      const value = values[seriesIndex]?.[index]
      if (value !== undefined) row[`s${seriesIndex}`] = value
    })
    return row
  })
  const gutter = endLabelGutter(rows, items.length)
  return { config, rows, count: items.length, margin: { ...chartMargin, left: gutter, right: gutter } }
}

function ChartFrame({
  labels,
  series,
  xLabel,
  yLabel,
  slot,
  kind,
  className,
  children,
}: {
  labels: unknown
  series: unknown
  xLabel: unknown
  yLabel: unknown
  slot: string
  kind: "bar" | "line" | "area"
  className?: string
  children: (model: ReturnType<typeof chartModel>, animate: boolean) => ReactNode
}) {
  const { theme } = useTheme()
  const streaming = useIsStreaming()
  const reduce = Boolean(useReducedMotion())
  const model = useMemo(() => chartModel(labels, series, chartColors(theme, kind, elements(series).length)),
    [labels, series, theme, kind])
  const animate = !streaming && !reduce
  const chart = useMemo(() => children(model, animate), [children, model, animate])
  if (model.rows.length === 0 || model.count === 0) return null
  return (
    <div data-slot={slot} className="flex min-w-0 flex-col gap-1">
      {textOf(yLabel) !== "" ? (
        <p className="text-xs" style={axisStyle}>{textOf(yLabel)}</p>
      ) : null}
      <ViewportChartContainer
        config={model.config}
        className={cn(
          "aspect-auto h-48 w-full [&_.recharts-cartesian-axis-tick-value]:![fill:var(--openui-text-neutral-secondary)]",
          className,
        )}
      >
        {chart}
      </ViewportChartContainer>
      {textOf(xLabel) !== "" ? (
        <p className="text-xs" style={axisStyle}>{textOf(xLabel)}</p>
      ) : null}
    </div>
  )
}

function renderBarChart(model: ReturnType<typeof chartModel>, animate: boolean) {
  return (
    <BarChart
      data={model.rows}
      margin={model.margin}
    >
      <CartesianGrid stroke="var(--openui-border-default)" vertical={false} />
      <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
      <ChartTooltip content={<ChartTooltipContent />} />
      {Array.from({ length: model.count }, (_, index) => (
        <Bar
          key={index}
          dataKey={`s${index}`}
          fill={`var(--color-s${index})`}
          radius={4}
          isAnimationActive={animate}
          animationDuration={320}
        >
          {chartValueLabel(`s${index}`)}
        </Bar>
      ))}
    </BarChart>
  )
}

const BarChartBlock = defineComponent({
  name: "BarChart",
  description: "Vertical bar chart. labels and each Series values array share an index.",
  props: z.object({
    labels: z.array(z.string()),
    series: z.array(Series.ref),
    xLabel: z.string().optional(),
    yLabel: z.string().optional(),
  }),
  component: ({ props }) => (
    <ChartFrame
      labels={props.labels}
      series={props.series}
      xLabel={props.xLabel}
      yLabel={props.yLabel}
      slot="render-ui-bar-chart"
      kind="bar"
    >
      {renderBarChart}
    </ChartFrame>
  ),
})

function renderLineChart(model: ReturnType<typeof chartModel>, animate: boolean) {
  const occupied = new Map<string, LabelBox>()
  return (
    <LineChart
      data={model.rows}
      margin={model.margin}
    >
      <CartesianGrid stroke="var(--openui-border-default)" vertical={false} />
      <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
      <ChartTooltip content={<ChartTooltipContent />} />
      {Array.from({ length: model.count }, (_, index) => {
        const seriesColor = `var(--color-s${index})`
        return (
          <Line
            key={index}
            type="monotone"
            dataKey={`s${index}`}
            stroke={seriesColor}
            strokeWidth={2}
            dot={{ r: 3, fill: seriesColor, stroke: seriesColor, strokeWidth: 0 }}
            activeDot={{ r: 4, fill: seriesColor, stroke: seriesColor, strokeWidth: 0 }}
            isAnimationActive={animate}
            animationDuration={320}
          >
            {lineValueLabels(`s${index}`, occupied)}
          </Line>
        )
      })}
    </LineChart>
  )
}

const LineChartBlock = defineComponent({
  name: "LineChart",
  description: "Line chart. labels and each Series values array share an index.",
  props: z.object({
    labels: z.array(z.string()),
    series: z.array(Series.ref),
    xLabel: z.string().optional(),
    yLabel: z.string().optional(),
  }),
  component: ({ props }) => (
    <ChartFrame
      labels={props.labels}
      series={props.series}
      xLabel={props.xLabel}
      yLabel={props.yLabel}
      slot="render-ui-line-chart"
      kind="line"
    >
      {renderLineChart}
    </ChartFrame>
  ),
})

function renderAreaChart(model: ReturnType<typeof chartModel>, animate: boolean) {
  return (
    <AreaChart data={model.rows} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
      <CartesianGrid stroke="var(--openui-border-default)" vertical={false} />
      <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} tickMargin={8} />
      <YAxis tick={axisTick} tickLine={false} axisLine={false} tickMargin={8} tickCount={3} width="auto" />
      <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
      {Array.from({ length: model.count }, (_, index) => {
        const seriesColor = `var(--color-s${index})`
        return (
          <Area
            key={index}
            type="natural"
            dataKey={`s${index}`}
            fill={seriesColor}
            fillOpacity={0.4}
            stroke={seriesColor}
            stackId="a"
            isAnimationActive={animate}
            animationDuration={320}
          />
        )
      })}
      <ChartLegend content={<ChartLegendContent />} />
    </AreaChart>
  )
}

const AreaChartBlock = defineComponent({
  name: "AreaChart",
  description:
    "Stacked area chart with axes and a legend. labels and each Series values array share an index.",
  props: z.object({
    labels: z.array(z.string()),
    series: z.array(Series.ref),
    xLabel: z.string().optional(),
    yLabel: z.string().optional(),
  }),
  component: ({ props }) => (
    <ChartFrame
      labels={props.labels}
      series={props.series}
      xLabel={props.xLabel}
      yLabel={props.yLabel}
      slot="render-ui-area-chart"
      kind="area"
      className="h-56"
    >
      {renderAreaChart}
    </ChartFrame>
  ),
})

const DonutChartBlock = defineComponent({
  name: "DonutChart",
  description:
    "Donut chart. labels and values share an index. centerLabel is the caption under the total.",
  props: z.object({
    labels: z.array(z.string()),
    values: z.array(z.number()),
    centerLabel: z.string().optional(),
  }),
  component: function DonutChartView({ props }) {
    const names = stringList(props.labels)
    const numbers = numberList(props.values)
    const count = Math.min(names.length, numbers.length)
    const colors = Array.from(
      { length: count },
      (_, index) => beuiDonutPalette[index % beuiDonutPalette.length] ?? beuiDonutPalette[0],
    )
    const segments = Array.from({ length: count }, (_, index) => ({
      id: `s${index}`,
      name: names[index] ?? "",
      value: numbers[index] ?? 0,
      color: colors[index] ?? colors[0] ?? "",
    })).filter((segment) => segment.name !== "" && segment.value > 0)
    if (segments.length === 0) return null
    const caption = textOf(props.centerLabel)
    return (
      <div data-slot="render-ui-donut-chart" className="min-w-0">
        <BeuiDonutChart
          segments={segments}
          formatValue={(value) => String(value)}
          label={caption || "Donut chart"}
        >
          <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
            <DonutChartPlot>
              <DonutChartCenter totalLabel={caption || "Total"} />
            </DonutChartPlot>
            <DonutChartLegend />
          </div>
        </BeuiDonutChart>
      </div>
    )
  },
})

// The child union is assigned after Stack and Card exist so each can contain the other.
let layoutChild: z.ZodType = z.never()

const Stack = defineComponent({
  name: "Stack",
  description:
    'Flex container. direction is column or row (default column). gap is none, xs, s, m, l, xl, or 2xl (default m). align is start, center, end, stretch, or baseline. justify is start, center, end, between, around, or evenly. wrap defaults to false.',
  props: z.object({
    children: z.array(z.lazy(() => layoutChild)),
    direction: z.enum(["column", "row"]).optional(),
    gap: z.enum(["none", "xs", "s", "m", "l", "xl", "2xl"]).optional(),
    align: z.enum(["start", "center", "end", "stretch", "baseline"]).optional(),
    justify: z.enum(["start", "center", "end", "between", "around", "evenly"]).optional(),
    wrap: z.boolean().optional(),
  }),
  component: ({ props, renderNode }) => {
    const direction = props.direction === "row" ? "row" : "column"
    const gap = namedChoice<Gap>(props.gap, gapClass, "m")
    const align = namedChoice<Align>(props.align, alignClass, "stretch")
    const justify = namedChoice<Justify>(props.justify, justifyClass, "start")
    return (
      <div
        data-slot="render-ui-stack"
        data-direction={direction}
        style={{ color: "var(--openui-text-neutral-primary)" }}
        className={cn(
          "flex min-w-0",
          direction === "row" ? "flex-row" : "flex-col",
          gapClass[gap],
          alignClass[align],
          justifyClass[justify],
          props.wrap === true ? "flex-wrap" : "flex-nowrap",
          direction === "row" && "*:min-w-0 *:flex-1 *:basis-0",
        )}
      >
        {renderNode(props.children)}
      </div>
    )
  },
})

const CardBlock = defineComponent({
  name: "Card",
  description: "Bordered group. Children stack vertically.",
  props: z.object({
    children: z.array(z.lazy(() => layoutChild)),
  }),
  component: ({ props, renderNode }) => (
    <OpenUiCard className="min-w-0" data-slot="render-ui-card" variant="sunk" width="full">
      {renderNode(props.children)}
    </OpenUiCard>
  ),
})

const FollowButton = defineComponent({
  name: "Button",
  description: 'Sends a new user turn. Write Button("Label", @ToAssistant("what the user decided")).',
  props: z.object({
    label: z.string(),
    action: action().optional(),
  }),
  component: function FollowButtonView({ props }) {
    const trigger = useTriggerAction()
    return (
      <OpenUiButton
        size="small"
        type="button"
        variant="primary"
        onClick={() => {
          void trigger(props.label, undefined, props.action)
        }}
      >
        {props.label}
      </OpenUiButton>
    )
  },
})

layoutChild = z.union([
  Stack.ref,
  CardBlock.ref,
  CardHeaderBlock.ref,
  Text.ref,
  BadgeBlock.ref,
  Table.ref,
  BarChartBlock.ref,
  LineChartBlock.ref,
  AreaChartBlock.ref,
  DonutChartBlock.ref,
  FollowButton.ref,
])

const componentGroups: ComponentGroup[] = [
  {
    name: "Layout",
    components: ["Stack", "Card", "CardHeader", "Text", "Badge"],
    notes: [
      "The root stacks vertically when direction is omitted.",
      'Use direction "row" only for at most three small cards. Start another Stack row for a fourth card.',
      "Leave wrap false.",
      "A table or chart occupies a full row under the cards.",
      "Use interactive_visualize when the user should press a button to continue.",
    ],
  },
  {
    name: "Data",
    components: ["Table", "Col", "BarChart", "LineChart", "AreaChart", "DonutChart", "Series"],
    notes: [
      "Define each label array, column array, Series, and donut values array on its own line, then reference it.",
    ],
  },
]

const staticComponents = [
  Stack,
  CardBlock,
  CardHeaderBlock,
  Text,
  BadgeBlock,
  Table,
  Col,
  BarChartBlock,
  LineChartBlock,
  AreaChartBlock,
  DonutChartBlock,
  Series,
]

const interactiveGroups: ComponentGroup[] = [
  {
    name: "Interaction",
    components: ["Button", "Stack", "Card", "CardHeader", "Text"],
    notes: [
      "Use Button when the user should send a follow-up to the agent.",
      "Use static_visualize for tables, charts, and status cards that do not need a button.",
    ],
  },
]

export const staticVisualizeLibrary = createLibrary({
  root: "Stack",
  componentGroups,
  components: staticComponents,
})

export const interactiveVisualizeLibrary = createLibrary({
  root: "Stack",
  componentGroups: interactiveGroups,
  components: [Stack, CardBlock, CardHeaderBlock, Text, FollowButton],
})
