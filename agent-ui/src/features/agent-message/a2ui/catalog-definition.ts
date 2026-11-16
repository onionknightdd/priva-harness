import { Catalog, CommonSchemas } from "@a2ui/web_core/v1_0"
import { z } from "zod-v3"

/** Shared by the renderer and the generated agent catalog. No React or DOM imports. */
export const A2UI_CATALOG_ID = "https://priva.app/a2ui/catalog/v1"

const text = CommonSchemas.DynamicString
const children = CommonSchemas.ChildList
const tone = z.enum(["default", "muted", "positive", "negative"])
const chartProperties = {
  title: text.describe("A concise chart title."),
  labels: z.array(z.string()).min(1).max(60).describe("Category labels, in display order."),
  series: z.array(z.object({
    name: z.string(),
    values: z.array(z.number().finite()).min(1).max(60),
  }).strict()).min(1).max(6).describe("Each series must have exactly one value for every label."),
  description: text.optional(),
  format: z.enum(["number", "currency", "percent"]).optional(),
  unit: z.string().max(12).optional().describe("Optional displayed unit suffix, e.g. M for millions. Currency uses $."),
}

export const componentDefinitions = {
  Column: {
    name: "Column",
    schema: z.object({ children, gap: z.enum(["small", "medium", "large"]).optional() }).strict()
      .describe("Vertical section layout. Use as the root of a dashboard or form."),
  },
  Row: {
    name: "Row",
    schema: z.object({ children }).strict().describe("Wrapping horizontal action or filter row."),
  },
  Grid: {
    name: "Grid",
    schema: z.object({ children, columns: z.number().int().min(1).max(4).optional() }).strict()
      .describe("Equal columns, default 4. Automatically reduces to 2 and 1 on smaller screens."),
  },
  Heading: {
    name: "Heading",
    schema: z.object({ text, subtitle: text.optional(), eyebrow: text.optional() }).strict()
      .describe("Main dashboard heading with optional eyebrow and explanatory subtitle."),
  },
  Text: {
    name: "Text",
    schema: z.object({ text, tone: tone.optional() }).strict().describe("Plain text. No HTML or Markdown."),
  },
  Stat: {
    name: "Stat",
    schema: z.object({
      label: text, value: text, delta: text.optional(), caption: text.optional(),
      trend: z.enum(["up", "down", "neutral"]).optional(),
    }).strict().describe("Raised KPI card with a prominent value, optional change badge and supporting caption."),
  },
  Card: {
    name: "Card",
    schema: z.object({ children, title: text.optional(), description: text.optional() }).strict()
      .describe("Raised content card. Charts and Stats already include their own card."),
  },
  Badge: {
    name: "Badge",
    schema: z.object({ text, tone: tone.optional() }).strict(),
  },
  Table: {
    name: "Table",
    schema: z.object({
      columns: z.array(z.string()).min(1).max(12),
      rows: z.array(z.array(z.union([z.string(), z.number().finite()])).max(12)).max(200),
      title: text.optional(),
    }).strict().describe("Data table. Every row must have one cell for each column."),
  },
  BarChart: { name: "BarChart", schema: z.object(chartProperties).strict().describe("Grouped bars for category comparisons.") },
  LineChart: { name: "LineChart", schema: z.object(chartProperties).strict().describe("Lines for changes over ordered categories or time.") },
  AreaChart: { name: "AreaChart", schema: z.object(chartProperties).strict().describe("Filled lines for trends and magnitudes over time.") },
  DonutChart: {
    name: "DonutChart",
    schema: z.object({
      title: text,
      labels: z.array(z.string()).min(1).max(12),
      values: z.array(z.number().finite().nonnegative()).min(1).max(12),
      description: text.optional(),
      format: z.enum(["number", "currency", "percent"]).optional(),
      unit: z.string().max(12).optional(),
    }).strict().describe("Part-to-whole breakdown. One non-negative value per label."),
  },
  Button: {
    name: "Button",
    schema: z.object({
      label: text, action: CommonSchemas.Action,
      variant: z.enum(["default", "outline", "secondary"]).optional(),
    }).strict().describe("An explicit user action. Use event.context for structured values or bound form values."),
  },
  TextField: {
    name: "TextField",
    schema: z.object({ label: text, value: text, placeholder: text.optional() }).strict()
      .describe("Labeled text input. Bind value to a data-model path for editable state and action context."),
  },
  Select: {
    name: "Select",
    schema: z.object({
      label: text, value: text,
      options: z.array(z.object({ label: z.string(), value: z.string() }).strict()).min(1).max(50),
    }).strict().describe("Labeled dropdown. Bind value to a data-model path and use that path in an action context."),
  },
} as const

export const a2uiCatalogDefinition = new Catalog(
  A2UI_CATALOG_ID,
  "1.0",
  Object.values(componentDefinitions),
  [],
  undefined,
  "Use one Column root. Lead dashboards with Heading, a Grid of Stats, charts, then a Row of optional actions. " +
    "Keep titles short, supply full category names, and ensure chart values align with labels. " +
    "Use the provided components; do not emit HTML, CSS, JavaScript, URLs, or unknown component types. " +
    "All inputs must bind to initialized data-model paths; button event.context can reference those paths.",
).toJson()
