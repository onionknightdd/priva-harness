import { Profiler, useState } from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { ThemeProvider } from "next-themes"

import { Button } from "../../../src/components/ui/button"
import { GeneratedVisual } from "../../../src/features/agent-message/render-ui/generated-visual"
import type { StreamBlock } from "../../../src/features/agent-message/agent-message-data"
import "../../../src/i18n"
import "../../../src/index.css"

const query = new URLSearchParams(location.search)
const dark = query.has("dark")
const chartProgram = (kind: string) => [
  "root = Stack([chart])",
  'labels = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"]',
  'pv = Series("页面浏览", [1200, 1450, 1380, 1720, 1960, 2140, 2050, 2380, 2510, 2760, 3020, 3350])',
  'uv = Series("独立访客", [420, 510, 480, 620, 700, 760, 720, 830, 890, 970, 1080, 1220])',
  'signup = Series("注册用户", [80, 95, 88, 120, 145, 160, 150, 180, 205, 230, 260, 300])',
  `chart = ${kind}(labels, [pv, uv, signup], "月份", "数量")`,
].join("\n")
const block = (kind: string): Extract<StreamBlock, { type: "tool_use" }> => ({
  type: "tool_use", id: kind, blockId: kind, index: 0, name: "static_visualize",
  input: { lang: chartProgram(kind) },
  tool: { id: kind, name: "static_visualize", input: { lang: chartProgram(kind) }, output: chartProgram(kind), ok: true, status: "completed" },
})
const area = block("AreaChart")
const line = block("LineChart")
let activeRun: { frames: number[]; commits: Record<string, number>; samples: unknown[] } | null = null
function onRender(id: string) { if (activeRun) activeRun.commits[id] = (activeRun.commits[id] ?? 0) + 1 }
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const settle = async (ms = 700) => { const start = performance.now(); while (performance.now() - start < ms) await nextFrame() }
const check = (condition: boolean, message: string) => { if (!condition) throw new Error(message); return message }

export function Fixture() {
  const [narrow, setNarrow] = useState(query.has("narrow"))
  const [separated, setSeparated] = useState(false)
  const [status, setStatus] = useState("Ready")
  const [results, setResults] = useState<unknown>(null)
  const [running, setRunning] = useState(false)

  async function run() {
    setRunning(true)
    setStatus("Running chart resize checks")
    const passed: string[] = []
    const measurements: unknown[] = []
    try {
      await document.fonts.ready
      flushSync(() => { setNarrow(false); setSeparated(false) })
      await settle()
      const viewport = document.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]')!
      const charts = [...viewport.querySelectorAll<HTMLElement>('[data-slot="chart"]')]
      const svgs = charts.map((chart) => chart.querySelector("svg.recharts-surface")!)
      const widths = () => charts.map((chart) => Math.round(chart.getBoundingClientRect().width))
      const svgWidths = () => svgs.map((svg) => Number(svg.getAttribute("width")))
      const mounted = () => svgs.every((svg, index) => svg.isConnected && charts[index]?.querySelector("svg.recharts-surface") === svg)
      const resize = async (next: boolean, name: string) => {
        const run = { name, frames: [] as number[], commits: {} as Record<string, number>, samples: [] as { at: number; containers: number[]; svg: number[] }[] }
        activeRun = run
        let last = performance.now()
        const sample = (time: number) => {
          if (activeRun !== run) return
          run.frames.push(time - last); last = time
          run.samples.push({ at: time, containers: widths(), svg: svgWidths() })
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
        flushSync(() => setNarrow(next))
        await settle(1000)
        activeRun = null
        measurements.push({ ...run, maxFrame: Math.max(...run.frames) })
        return run
      }
      passed.push(check(charts.length === 2 && widths().every((width, index) => width === svgWidths()[index]), "Both charts match their initial container size"))
      const visibleResize = await resize(true, "both-visible-narrow")
      passed.push(check(svgs.every((_, index) => new Set(visibleResize.samples.map((sample) => sample.svg[index])).size > 2), "Visible charts receive intermediate sizes during the transition"))
      passed.push(check(widths().every((width, index) => width === svgWidths()[index]), "Both visible charts resize to the narrow width"))
      passed.push(check(mounted(), "Resize preserves both SVG instances"))
      flushSync(() => setSeparated(true))
      viewport.scrollTop = viewport.scrollHeight
      await settle()
      const frozenWidth = svgWidths()[0]
      const offscreenResize = await resize(false, "area-offscreen-wide")
      passed.push(check(offscreenResize.samples.every((sample) => sample.svg[0] === frozenWidth), "Offscreen area chart does not receive intermediate resize updates"))
      passed.push(check(svgWidths()[1] === widths()[1], "Visible line chart continues resizing"))
      passed.push(check(viewport.scrollWidth <= viewport.clientWidth + 1, "Frozen charts do not create horizontal scrolling"))
      viewport.scrollTop = 0
      await settle()
      passed.push(check(svgWidths()[0] === widths()[0] && mounted(), "Fast scroll restores current geometry without remounting"))
      // A reversal during the width transition must settle at the latest size.
      flushSync(() => setNarrow(true))
      await settle(80)
      flushSync(() => setNarrow(false))
      await settle()
      passed.push(check(svgWidths()[0] === widths()[0], "Interrupted resize settles at the latest width"))
      flushSync(() => setSeparated(false))
      viewport.scrollTop = 0
      await settle()
      passed.push(check(mounted() && widths().every((width, index) => width === svgWidths()[index]), "Both charts return with their original instances and current dimensions"))
      setResults({ passed, measurements })
      setStatus(`Passed ${passed.length} chart resize checks`)
    } catch (error) {
      activeRun = null
      setResults({ passed, measurements, error: String(error) })
      setStatus(`Failed: ${String(error)}`)
    } finally { setRunning(false) }
  }

  return <main className="min-h-screen bg-background p-6 text-foreground">
    <div className="mb-4 flex gap-3">
      <Button disabled={running} onClick={() => void run()}>Run chart resize checks</Button>
      <Button variant="outline" disabled={running} onClick={() => setNarrow((value) => !value)}>Toggle width</Button>
      <Button variant="outline" disabled={running} onClick={() => setSeparated((value) => !value)}>Separate charts</Button>
      <span role="status">{status}</span>
    </div>
    <div data-slot="message-scroller-viewport" className="h-[580px] overflow-y-auto overflow-x-hidden" style={{ width: narrow ? 475 : 754, transition: "width 200ms linear" }}>
      <Profiler id="area" onRender={onRender}><GeneratedVisual block={area} /></Profiler>
      <div style={{ height: separated ? 1200 : 24 }} />
      <Profiler id="line" onRender={onRender}><GeneratedVisual block={line} /></Profiler>
      <div className="h-12" />
    </div>
    <details className="mt-4"><summary>Measurement results</summary><pre id="chart-resize-results">{JSON.stringify(results, null, 2)}</pre></details>
  </main>
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" forcedTheme={dark ? "dark" : "light"}><Fixture /></ThemeProvider>,
)
