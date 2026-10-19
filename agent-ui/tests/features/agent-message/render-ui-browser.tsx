import { createInstance } from "i18next"
import { useState } from "react"
import { createRoot } from "react-dom/client"
import { I18nextProvider, initReactI18next } from "react-i18next"

import { GeneratedVisual } from "../../../src/features/agent-message/render-ui/generated-visual"
import type { StreamBlock } from "../../../src/features/agent-message/agent-message-data"
import { en } from "../../../src/i18n/locales/en"
import "../../../src/index.css"

const lines = [
  "root = Stack([header, row, chart])",
  'header = CardHeader("Revenue", "Q3")',
  'row = Stack([a, b, c], "row", "m", "stretch")',
  'a = Card([Text("Events", "small"), Text("1280", "large"), Badge("Live", "success")])',
  'b = Card([Text("Users", "small"), Text("86", "large")])',
  'c = Card([Text("Avg", "small"), Text("183", "large")])',
  'labels = ["Jul", "Aug", "Sep"]',
  'series = Series("Revenue", [380, 410, 440])',
  "chart = BarChart(labels, [series])",
]

const finished = lines.join("\n")
const line = [
  "root = Stack([chart])",
  'labels = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"]',
  'pv = Series("页面浏览", [1200, 1450, 1380, 1720, 1960, 2140, 2050, 2380, 2510, 2760, 3020, 3350])',
  'uv = Series("独立访客", [420, 510, 480, 620, 700, 760, 720, 830, 890, 970, 1080, 1220])',
  'signup = Series("注册用户", [80, 95, 88, 120, 145, 160, 150, 180, 205, 230, 260, 300])',
  'chart = LineChart(labels, [pv, uv, signup], "月份", "数量")',
].join("\n")

const area = [
  "root = Stack([chart])",
  'labels = ["1月", "2月", "3月", "4月", "5月", "6月"]',
  'views = Series("页面浏览", [400, 420, 450, 480, 500, 520])',
  'visitors = Series("独立访客", [160, 180, 200, 220, 240, 280])',
  'signups = Series("注册用户", [60, 70, 80, 90, 100, 200])',
  'chart = AreaChart(labels, [views, visitors, signups], "月份", "数量")',
].join("\n")

const donut = [
  "root = Stack([chart])",
  'labels = ["Team", "Business", "Enterprise", "Starter"]',
  "values = [42900, 31250, 22600, 18400]",
  'chart = DonutChart(labels, values, "Monthly revenue")',
].join("\n")

const choice = [
  "root = Stack([title, action])",
  'title = Text("Raise the budget?", "body")',
  'action = Button("Use 350", @ToAssistant("Make it under $350 a night"))',
].join("\n")

function toolBlock(lang: string, running: boolean): Extract<StreamBlock, { type: "tool_use" }> {
  return {
    type: "tool_use",
    id: "ui",
    blockId: "ui",
    index: 0,
    name: "static_visualize",
    input: { lang },
    tool: {
      id: "ui",
      name: "static_visualize",
      status: running ? "started" : "completed",
      ok: true,
      output: running ? undefined : lang,
      input: { lang },
    },
  }
}

function Fixture() {
  const [count, setCount] = useState(1)
  const lang = lines.slice(0, count).join("\n")
  const running = count < lines.length
  return (
    <main className="bg-background text-foreground min-h-screen p-6">
      <button
        id="stream"
        type="button"
        className="mb-6 rounded-md border px-3 py-2 text-sm"
        onClick={() => setCount((current) => Math.min(lines.length, current + 1))}
      >
        Stream next line
      </button>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 42rem) 390px", gap: 32, alignItems: "start" }}>
        <section data-slot="render-ui-wide">
          <GeneratedVisual block={toolBlock(lang, running)} />
        </section>
        <section data-slot="render-ui-narrow" style={{ width: 390 }}>
          <GeneratedVisual block={toolBlock(finished, false)} />
        </section>
        <section data-slot="render-ui-line" style={{ width: 720 }}>
          <GeneratedVisual block={toolBlock(line, false)} />
        </section>
        <section data-slot="render-ui-area">
          <GeneratedVisual block={toolBlock(area, false)} />
        </section>
        <section data-slot="render-ui-donut">
          <GeneratedVisual block={toolBlock(donut, false)} />
        </section>
        <section data-slot="render-ui-choice">
          <GeneratedVisual block={{ ...toolBlock(choice, false), name: "interactive_visualize" }} />
        </section>
        <section data-slot="render-ui-failed-interactive">
          <GeneratedVisual block={{
            ...toolBlock('root = Stack([title])\ntitle = Text("Still visible")', true),
            id: "failed-interactive",
            blockId: "failed-interactive",
            name: "interactive_visualize",
            tool: {
              id: "failed-interactive",
              name: "interactive_visualize",
              status: "started",
              ok: false,
              output: "unknown-component: Widget",
              input: { lang: 'root = Stack([title])\ntitle = Text("Still visible")' },
            },
          }} />
        </section>
        <section data-slot="render-ui-rejected-interactive">
          <GeneratedVisual block={{
            ...toolBlock([
              "root = Stack([title, chart])",
              'title = Text("Pick a city")',
              'labels = ["A"]',
              'series = Series("S", [1])',
              "chart = BarChart(labels, [series])",
            ].join("\n"), false),
            id: "rejected-interactive",
            blockId: "rejected-interactive",
            name: "interactive_visualize",
            tool: {
              id: "rejected-interactive",
              name: "interactive_visualize",
              status: "completed",
              ok: true,
              output: [
                "root = Stack([title, chart])",
                'title = Text("Pick a city")',
                'labels = ["A"]',
                'series = Series("S", [1])',
                "chart = BarChart(labels, [series])",
              ].join("\n"),
              input: { lang: "" },
            },
          }} />
        </section>
        <section data-slot="render-ui-failed">
          <GeneratedVisual block={{
            ...toolBlock('root = Stack([title])\ntitle = Text("Hidden")', false),
            id: "failed",
            blockId: "failed",
            tool: {
              id: "failed",
              name: "static_visualize",
              status: "completed",
              ok: false,
              output: "type-mismatch: field \"/series/0\" expects Series but got number",
              input: { lang: 'root = Stack([title])\ntitle = Text("Hidden")' },
            },
          }} />
        </section>
      </div>
    </main>
  )
}

const query = new URLSearchParams(location.search)
document.documentElement.classList.toggle("dark", query.has("dark"))
const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: "en",
  resources: { en: { translation: en } },
})

createRoot(document.getElementById("root")!).render(
  <I18nextProvider i18n={i18n}>
    <Fixture />
  </I18nextProvider>,
)
