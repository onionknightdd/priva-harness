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
        <section data-slot="render-ui-choice">
          <GeneratedVisual block={{ ...toolBlock(choice, false), name: "interactive_visualize" }} />
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
