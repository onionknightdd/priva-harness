/* oxlint-disable react/only-export-components -- component catalog consumed by the A2UI renderer */
import { Fragment, useId, useState } from "react"
import { createComponentImplementation } from "@a2ui/react"
import { Catalog, type ResolvedChildRef } from "@a2ui/web_core/v1_0"
import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

import { A2UI_CATALOG_ID, componentDefinitions as definitions } from "./catalog-definition"
import { CartesianChart, DonutChartView } from "./charts"
import { useA2uiInteraction } from "./interaction"
import { DashboardTabs } from "./tabs"
import { DashboardImage } from "./image"
import { DashboardIcon } from "./icons"
import { DashboardImageGallery } from "./gallery"

function displayText(value: unknown): string {
  if (typeof value !== "string") throw new Error("A2UI text must resolve to a string.")
  return value
}

function childrenOf(children: (string | ResolvedChildRef)[], buildChild: (id: string, path?: string) => React.ReactNode) {
  return children.map((child, index) => <Fragment key={typeof child === "string" ? child : `${child.id}-${child.basePath}-${index}`}>
    {typeof child === "string" ? buildChild(child) : buildChild(child.id, child.basePath)}
  </Fragment>)
}

const Column = createComponentImplementation(definitions.Column, ({ props, buildChild }) => (
  <div className="a2ui-column" data-gap={props.gap ?? "large"}>{childrenOf(props.children, buildChild)}</div>
))
const Row = createComponentImplementation(definitions.Row, ({ props, buildChild }) => (
  <div className="a2ui-row">{childrenOf(props.children, buildChild)}</div>
))
const Grid = createComponentImplementation(definitions.Grid, ({ props, buildChild }) => (
  <div className="a2ui-grid" data-columns={props.columns ?? 4}>{childrenOf(props.children, buildChild)}</div>
))
const Heading = createComponentImplementation(definitions.Heading, ({ props }) => (
  <header className="a2ui-heading">
    {props.eyebrow ? <p className="a2ui-eyebrow">{props.eyebrow}</p> : null}
    <h2>{props.text}</h2>
    {props.subtitle ? <p className="a2ui-subtitle">{props.subtitle}</p> : null}
  </header>
))
const Text = createComponentImplementation(definitions.Text, ({ props }) => <p className="a2ui-text" data-tone={props.tone}>{props.text}</p>)
const Stat = createComponentImplementation(definitions.Stat, ({ props }) => {
  const Icon = props.trend === "down" ? ArrowDownRightIcon : props.trend === "neutral" ? MinusIcon : ArrowUpRightIcon
  return (
    <Card className="a2ui-card a2ui-stat">
      <CardContent>
        <p className="a2ui-stat-label">{props.label}</p>
        <p className="a2ui-stat-value">{props.value}</p>
        {props.delta ? <Badge variant="outline" className="a2ui-stat-delta"><Icon aria-hidden="true" />{props.delta}</Badge> : null}
        {props.caption ? <p className="a2ui-stat-caption">{props.caption}</p> : null}
      </CardContent>
    </Card>
  )
})
const ContentCard = createComponentImplementation(definitions.Card, ({ props, buildChild }) => (
  <Card className="a2ui-card">
    {props.title || props.description ? <CardHeader>{props.title ? <CardTitle>{props.title}</CardTitle> : null}{props.description ? <CardDescription>{props.description}</CardDescription> : null}</CardHeader> : null}
    <CardContent>{childrenOf(props.children, buildChild)}</CardContent>
  </Card>
))
const StatusBadge = createComponentImplementation(definitions.Badge, ({ props }) => <Badge variant="outline" data-tone={props.tone}>{props.text}</Badge>)
const Table = createComponentImplementation(definitions.Table, ({ props }) => {
  if (props.rows.some((row) => row.length !== props.columns.length)) throw new Error("Table rows must have one cell for every column.")
  return <Card className="a2ui-card a2ui-table-card"><div className="a2ui-table-scroll"><table>
    {props.title ? <caption>{props.title}</caption> : null}
    <thead><tr>{props.columns.map((label, index) => <th scope="col" key={index}>{displayText(label)}</th>)}</tr></thead>
    <tbody>{props.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody>
  </table></div></Card>
})
const ActionButton = createComponentImplementation(definitions.Button, ({ props }) => {
  const interactive = useA2uiInteraction()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const onClick = async () => {
    if (pending) return
    setPending(true)
    setError(undefined)
    try { await props.action() } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setPending(false) }
  }
  return <div className="a2ui-action">
    <Button variant={props.variant ?? "outline"} disabled={pending || !interactive} aria-busy={pending} onClick={onClick}>{props.label}</Button>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </div>
})
const TextField = createComponentImplementation(definitions.TextField, ({ props }) => {
  const id = useId()
  return <div className="a2ui-field"><Label htmlFor={id}>{props.label}</Label><Input id={id} value={props.value ?? ""} placeholder={props.placeholder} onChange={(event) => props.setValue(event.target.value)} /></div>
})
const SelectField = createComponentImplementation(definitions.Select, ({ props }) => {
  const id = useId()
  return <div className="a2ui-field"><Label htmlFor={id}>{props.label}</Label>
    <Select value={props.value} onValueChange={(value) => { if (value != null) props.setValue(value) }} items={props.options}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>{props.options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
    </Select>
  </div>
})

export const a2uiCatalog = new Catalog(A2UI_CATALOG_ID, "1.0", [
  Column, Row, Grid, Heading, Text, Stat, ContentCard, StatusBadge, Table, ActionButton, TextField, SelectField,
  createComponentImplementation(definitions.Tabs, ({ props, buildChild }) => <DashboardTabs tabs={props.tabs} buildChild={buildChild} />),
  createComponentImplementation(definitions.Image, ({ props }) => <DashboardImage url={displayText(props.url)} description={displayText(props.description)} fit={props.fit} />),
  createComponentImplementation(definitions.ImageGallery, ({ props }) => <DashboardImageGallery
    title={props.title === undefined ? undefined : displayText(props.title)}
    images={props.images.map((item) => ({
      url: displayText(item.url),
      description: displayText(item.description),
      ...(item.title === undefined ? {} : { title: displayText(item.title) }),
    }))}
  />),
  createComponentImplementation(definitions.Icon, ({ props }) => <DashboardIcon {...props} />),
  createComponentImplementation(definitions.BarChart, ({ props }) => <CartesianChart {...props} title={displayText(props.title)} labels={props.labels.map(displayText)} kind="bar" />),
  createComponentImplementation(definitions.LineChart, ({ props }) => <CartesianChart {...props} title={displayText(props.title)} labels={props.labels.map(displayText)} kind="line" />),
  createComponentImplementation(definitions.AreaChart, ({ props }) => <CartesianChart {...props} title={displayText(props.title)} labels={props.labels.map(displayText)} kind="area" />),
  createComponentImplementation(definitions.DonutChart, ({ props }) => <DonutChartView {...props} title={displayText(props.title)} labels={props.labels.map(displayText)} />),
])
