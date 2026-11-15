import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import { AgentToRendererMessageSchema } from "@a2ui/web_core/v1_0"

import "@/index.css"
import { A2uiVisual, type A2uiAction } from "@/features/agent-message/a2ui/a2ui-visual"
import salesResult from "../../fixtures/a2ui/sales-dashboard.json"
import formResult from "../../fixtures/a2ui/form-action.json"
import chartsResult from "../../fixtures/a2ui/all-charts.json"

const salesMessages = salesResult.messages.map((message) => AgentToRendererMessageSchema.parse(message))
const formMessages = formResult.messages.map((message) => AgentToRendererMessageSchema.parse(message))
const chartMessages = chartsResult.messages.map((message) => AgentToRendererMessageSchema.parse(message))

export function Fixture() {
  const [scenario, setScenario] = useState("sales")
  const messages = scenario === "sales" ? salesMessages : scenario === "form" ? formMessages : chartMessages
  const [width, setWidth] = useState("1120px")
  const [theme, setTheme] = useState("light")
  const [actions, setActions] = useState<A2uiAction[]>([])
  const [report, setReport] = useState<string[]>([])
  const [generation, setGeneration] = useState(0)
  const onAction = (action: A2uiAction) => { setActions((previous) => [...previous, action]) }
  const runChecks = () => {
    const root = document.querySelector<HTMLElement>("[data-slot='a2ui-visual']")!
    if (scenario === "charts") {
      setReport([
        ["line chart", Boolean(root.querySelector(".recharts-line"))],
        ["area chart", Boolean(root.querySelector(".recharts-area"))],
        ["donut chart", Boolean(root.querySelector(".recharts-pie-sector"))],
        ["data table", Boolean(root.querySelector(".a2ui-table-scroll tbody tr"))],
        ["no horizontal overflow", root.scrollWidth <= root.clientWidth + 1],
        ["no rendering errors", root.querySelector("[role='alert']") === null],
      ].map(([label, ok]) => `${ok ? "PASS" : "FAIL"} ${label}`))
      return
    }
    if (scenario === "form") {
      setReport([
        ["bound text input", root.querySelector<HTMLInputElement>("input")?.value !== undefined],
        ["accessible select", Boolean(root.querySelector("[role='combobox']"))],
        ["no horizontal overflow", root.scrollWidth <= root.clientWidth + 1],
        ["no rendering errors", root.querySelector("[role='alert']") === null],
      ].map(([label, ok]) => `${ok ? "PASS" : "FAIL"} ${label}`))
      return
    }
    const grid = root.querySelector<HTMLElement>(".a2ui-grid")!
    const expectedColumns = root.clientWidth < 430 ? 1 : root.clientWidth < 760 ? 2 : 4
    const cards = Array.from(root.querySelectorAll<HTMLElement>(".a2ui-stat"))
    const surfaceStyle = getComputedStyle(root.querySelector(".a2ui-surface")!)
    const motionIsReduced = surfaceStyle.transform === "none" && surfaceStyle.transitionDuration.split(",").every((duration) => {
      const seconds = Number.parseFloat(duration) / (duration.trim().endsWith("ms") ? 1000 : 1)
      // The application uses 0.01ms !important to preserve transition end events.
      return seconds <= 0.001
    })
    const checks = [
      ["official renderer mounted", Boolean(root.querySelector("[data-a2ui-surface='main'] h2"))],
      ["all four KPI values", cards.length === 4 && ["$14.8M", "108%", "14.2%", "North America"].every((text) => cards.some((card) => card.textContent?.includes(text)))],
      ["responsive grid columns", getComputedStyle(grid).gridTemplateColumns.split(" ").length === expectedColumns],
      ["equal KPI widths", cards.every((card) => Math.abs(card.getBoundingClientRect().width - cards[0].getBoundingClientRect().width) < 1)],
      ["chart drawn", root.querySelectorAll(".recharts-bar-rectangle").length === 8],
      ["chart data accessible", root.querySelectorAll("table.sr-only tbody tr").length === 4],
      ["no horizontal overflow", root.scrollWidth <= root.clientWidth + 1],
      ["no rendering errors", root.querySelector("[role='alert']") === null],
      ["theme propagated", getComputedStyle(root).color === getComputedStyle(document.body).color],
      ["motion preference honored", !matchMedia("(prefers-reduced-motion: reduce)").matches || motionIsReduced],
    ] as const
    setReport(checks.map(([label, ok]) => `${ok ? "PASS" : "FAIL"} ${label}`))
  }
  return <main style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 20px 60px" }}>
    <div className="mb-6 flex flex-wrap items-center gap-3 text-sm" aria-label="Isolation controls">
      <strong>A2UI · isolated sales dashboard</strong>
      <label>Scenario <select aria-label="Scenario" value={scenario} onChange={(event) => { setScenario(event.target.value); setReport([]) }} className="rounded border px-2 py-1"><option value="sales">Sales dashboard</option><option value="form">Interactive form</option><option value="charts">Chart gallery</option></select></label>
      <label>Width <select aria-label="Viewport width" value={width} onChange={(event) => setWidth(event.target.value)} className="rounded border px-2 py-1"><option value="1120px">Desktop</option><option value="680px">Tablet</option><option value="380px">Phone</option></select></label>
      <button type="button" onClick={() => { const next = theme === "light" ? "dark" : "light"; setTheme(next); document.documentElement.classList.toggle("dark", next === "dark") }} className="rounded border px-3 py-1">Theme: {theme}</button>
      <button type="button" onClick={() => setGeneration((value) => value + 1)} className="rounded border px-3 py-1">Replay saved messages</button>
      <button type="button" onClick={runChecks} className="rounded border px-3 py-1">Run checks</button>
    </div>
    <div style={{ width, maxWidth: "100%", margin: "0 auto" }}><A2uiVisual key={generation} messages={messages} onAction={onAction} /></div>
    <div className="mt-8 grid gap-4 md:grid-cols-2">
      <section aria-label="Checks"><h2 className="mb-2 font-medium">Checks</h2><pre data-testid="a2ui-checks" className="whitespace-pre-wrap text-xs">{report.join("\n") || "Choose a width, then run checks."}</pre></section>
      <section aria-label="Actions"><h2 className="mb-2 font-medium">Actions ({actions.length})</h2><pre data-testid="a2ui-actions" className="whitespace-pre-wrap text-xs">{JSON.stringify(actions, null, 2)}</pre></section>
    </div>
  </main>
}
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>)
