import { useId, type ReactNode } from "react"
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  Pie, PieChart, XAxis, YAxis,
} from "recharts"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"

import { ViewportChartContainer } from "./viewport-chart-container"

export type ChartSeries = { name: string; values: number[] }
export type ChartProps = {
  title: string
  labels: string[]
  series: ChartSeries[]
  description?: string
  format?: "number" | "currency" | "percent"
  unit?: string
}
type DonutProps = Omit<ChartProps, "series"> & { values: number[] }

const colors = ["var(--a2ui-chart-1)", "var(--a2ui-chart-2)", "var(--a2ui-chart-3)", "var(--a2ui-chart-4)", "var(--a2ui-chart-5)", "var(--a2ui-chart-6)"]
const axisTick = { fill: "var(--muted-foreground)", fontSize: 12 }

function numberLabel(value: number, format?: ChartProps["format"], unit = "") {
  const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
  return `${format === "currency" ? "$" : ""}${number}${format === "percent" ? "%" : ""}${unit}`
}

function ChartCard({ title, description, legend, children }: {
  title: string; description?: string; legend: { name: string; color: string }[]; children: ReactNode
}) {
  return (
    <Card className="a2ui-card a2ui-chart-card">
      <CardHeader className="a2ui-chart-header">
        <div className="a2ui-chart-heading">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        <ul className="a2ui-chart-legend" aria-label="Legend">
          {legend.map((item, index) => <li key={`${index}-${item.name}`}><span style={{ background: item.color }} />{item.name}</li>)}
        </ul>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function DataTable({ labels, series, format, unit }: Pick<ChartProps, "labels" | "series" | "format" | "unit">) {
  return (
    <table className="sr-only">
      <caption>Chart data</caption>
      <thead><tr><th scope="col">Category</th>{series.map((item, index) => <th scope="col" key={index}>{item.name}</th>)}</tr></thead>
      <tbody>{labels.map((label, index) => <tr key={index}><th scope="row">{label}</th>{series.map((item, s) => <td key={s}>{numberLabel(item.values[index], format, unit)}</td>)}</tr>)}</tbody>
    </table>
  )
}

/** Numeric charts stay still: the surface entrance communicates completion, data never animates on replay. */
export function CartesianChart({ kind, ...props }: ChartProps & { kind: "bar" | "line" | "area" }) {
  const { title, description, labels, series, format, unit } = props
  const gradientId = useId().replace(/:/g, "")
  if (series.some((item) => item.values.length !== labels.length)) throw new Error("Chart series must contain one value for every label.")
  const data = labels.map((label, index) => ({ label, ...Object.fromEntries(series.map((item, s) => [`s${s}`, item.values[index]])) }))
  const config: ChartConfig = Object.fromEntries(series.map((item, index) => [`s${index}`, { label: item.name, color: colors[index % colors.length] }]))
  const formatValue = (value: number) => numberLabel(value, format, unit)
  const axes = <>
    <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 6" strokeOpacity={0.65} />
    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} tickMargin={12} minTickGap={14} height={45} />
    <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={formatValue} tickMargin={10} width={66} />
    <ChartTooltip content={<ChartTooltipContent formatter={(value, name) => <><span className="text-muted-foreground">{name}</span><span className="ml-auto font-medium tabular-nums">{formatValue(Number(value))}</span></>} />} />
  </>
  const common = { data, margin: { top: 14, right: 14, bottom: 2, left: 0 }, accessibilityLayer: true }
  let chart: ReactNode
  if (kind === "bar") {
    chart = <BarChart {...common} barCategoryGap="28%" barGap={8}>{axes}{series.map((item, index) => <Bar key={index} name={item.name} dataKey={`s${index}`} fill={colors[index % colors.length]} radius={[5, 5, 0, 0]} maxBarSize={38} isAnimationActive={false} />)}</BarChart>
  } else if (kind === "line") {
    chart = <LineChart {...common}>{axes}{series.map((item, index) => <Line key={index} name={item.name} dataKey={`s${index}`} stroke={colors[index % colors.length]} strokeWidth={2.5} dot={{ r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive={false} />)}</LineChart>
  } else {
    chart = <AreaChart {...common}><defs>{series.map((_, index) => <linearGradient key={index} id={`${gradientId}-${index}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={colors[index % colors.length]} stopOpacity={0.28} /><stop offset="100%" stopColor={colors[index % colors.length]} stopOpacity={0.02} /></linearGradient>)}</defs>{axes}{series.map((item, index) => <Area key={index} name={item.name} dataKey={`s${index}`} stroke={colors[index % colors.length]} fill={`url(#${gradientId}-${index})`} strokeWidth={2.5} isAnimationActive={false} />)}</AreaChart>
  }
  return (
    <ChartCard title={title} description={description} legend={series.map((item, index) => ({ name: item.name, color: colors[index % colors.length] }))}>
      <ViewportChartContainer config={config} className="a2ui-chart" aria-label={title}>{chart}</ViewportChartContainer>
      <DataTable {...props} />
    </ChartCard>
  )
}

export function DonutChartView({ title, description, labels, values, format, unit }: DonutProps) {
  if (labels.length !== values.length) throw new Error("Donut values must match its labels.")
  const data = labels.map((name, index) => ({ name, value: values[index], fill: colors[index % colors.length] }))
  const config = Object.fromEntries(labels.map((label, index) => [`s${index}`, { label, color: colors[index % colors.length] }]))
  return (
    <ChartCard title={title} description={description} legend={data.map((item) => ({ name: item.name, color: item.fill }))}>
      <ViewportChartContainer config={config} className="a2ui-chart" aria-label={title}>
        <PieChart accessibilityLayer>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="83%" stroke="var(--card)" strokeWidth={4} isAnimationActive={false}>
            {data.map((item, index) => <Cell key={index} fill={item.fill} />)}
          </Pie>
          <ChartTooltip content={<ChartTooltipContent formatter={(value, name) => <><span className="text-muted-foreground">{name}</span><span className="ml-auto font-medium tabular-nums">{numberLabel(Number(value), format, unit)}</span></>} />} />
        </PieChart>
      </ViewportChartContainer>
      <DataTable labels={labels} series={[{ name: title, values }]} format={format} unit={unit} />
    </ChartCard>
  )
}
