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

export { Renderer }
import { useReducedMotion } from "motion/react"
import type { ReactNode } from "react"
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis } from "recharts"
import { z } from "zod/v4"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { cn } from "@/lib/utils"

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
  small: "text-xs text-muted-foreground",
  body: "text-sm",
  large: "text-base font-medium",
} as const

const badgeVariant = {
  neutral: "outline",
  info: "default",
  success: "secondary",
  warning: "outline",
  danger: "destructive",
} as const

type Gap = keyof typeof gapClass
type Align = keyof typeof alignClass
type Justify = keyof typeof justifyClass
type TextSize = keyof typeof textClass
type BadgeTone = keyof typeof badgeVariant

const chartColors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

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
      <p data-slot="render-ui-text" data-size={size} className={textClass[size]}>
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
    const tone = namedChoice<BadgeTone>(props.variant, badgeVariant, "neutral")
    return <Badge variant={badgeVariant[tone]}>{props.text}</Badge>
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
    <div data-slot="render-ui-header">
      <CardTitle>{props.title}</CardTitle>
      {props.description ? <CardDescription>{props.description}</CardDescription> : null}
    </div>
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
            <tr className="border-b border-border text-left text-muted-foreground">
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
              <tr key={row} className="border-b border-border/60 last:border-0">
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

function chartModel(labels: unknown, series: unknown) {
  const names = stringList(labels)
  const items = elements(series)
  const config: ChartConfig = {}
  items.forEach((item, index) => {
    config[`s${index}`] = {
      label: textOf(item.props.name) || `Series ${index + 1}`,
      color: chartColors[index % chartColors.length],
    }
  })
  const rows = names.map((label, index) => {
    const row: Record<string, string | number> = { label }
    items.forEach((item, seriesIndex) => {
      const value = numberList(item.props.values)[index]
      if (value !== undefined) row[`s${seriesIndex}`] = value
    })
    return row
  })
  return { config, rows, count: items.length }
}

function ChartFrame({
  labels,
  series,
  xLabel,
  yLabel,
  slot,
  children,
}: {
  labels: unknown
  series: unknown
  xLabel: unknown
  yLabel: unknown
  slot: string
  children: (model: ReturnType<typeof chartModel>, animate: boolean) => ReactNode
}) {
  const streaming = useIsStreaming()
  const reduce = Boolean(useReducedMotion())
  const model = chartModel(labels, series)
  if (model.rows.length === 0 || model.count === 0) return null
  return (
    <div data-slot={slot} className="flex min-w-0 flex-col gap-1">
      {textOf(yLabel) !== "" ? (
        <p className="text-xs text-muted-foreground">{textOf(yLabel)}</p>
      ) : null}
      <ChartContainer config={model.config} className="aspect-auto h-48 w-full">
        {children(model, !streaming && !reduce)}
      </ChartContainer>
      {textOf(xLabel) !== "" ? (
        <p className="text-xs text-muted-foreground">{textOf(xLabel)}</p>
      ) : null}
    </div>
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
    >
      {(model, animate) => (
        <BarChart data={model.rows}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {Array.from({ length: model.count }, (_, index) => (
            <Bar
              key={index}
              dataKey={`s${index}`}
              fill={`var(--color-s${index})`}
              radius={4}
              isAnimationActive={animate}
              animationDuration={320}
            />
          ))}
        </BarChart>
      )}
    </ChartFrame>
  ),
})

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
    >
      {(model, animate) => (
        <LineChart data={model.rows}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {Array.from({ length: model.count }, (_, index) => (
            <Line
              key={index}
              type="monotone"
              dataKey={`s${index}`}
              stroke={`var(--color-s${index})`}
              strokeWidth={2}
              dot={false}
              isAnimationActive={animate}
              animationDuration={320}
            />
          ))}
        </LineChart>
      )}
    </ChartFrame>
  ),
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
    <Card size="sm" data-slot="render-ui-card" className="min-w-0">
      <div className="flex flex-col gap-3 px-(--card-spacing)">{renderNode(props.children)}</div>
    </Card>
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
      <Button
        type="button"
        size="sm"
        onClick={() => {
          void trigger(props.label, undefined, props.action)
        }}
      >
        {props.label}
      </Button>
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
    components: ["Table", "Col", "BarChart", "LineChart", "Series"],
    notes: [
      "Define each label array, column array, and Series on its own line, then reference it.",
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
