import { act } from "react"
import { createRoot } from "react-dom/client"

import i18n from "../../../src/i18n"
import "../../../src/index.css"
import { UsageHeatmap } from "../../../src/features/usage/usage-heatmap"
import type { UsageDay } from "../../../src/features/usage/usage-api"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const params = new URLSearchParams(location.search)
document.documentElement.classList.toggle("dark", params.has("dark"))
if (params.has("zh")) await i18n.changeLanguage("zh-CN")

// Deterministic year of activity that ramps up over the last six months, so
// the grid shows both the empty early months and dense recent weeks.
function syntheticDays(count: number): UsageDay[] {
  const days: UsageDay[] = []
  const today = new Date()
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(today)
    date.setDate(today.getDate() - offset)
    const iso = date.toISOString().slice(0, 10)
    let hash = 0
    for (const character of iso) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
    const ramp = Math.max(0, 1 - offset / 200)
    const active = ramp > 0 && hash % 7 !== 0
    const tokens = active ? Math.round((20_000 + (hash % 180_000)) * ramp) : 0
    days.push({ date: iso, runs: tokens ? 1 + (hash % 5) : 0, processedTokens: tokens })
  }
  return days
}

const host = document.querySelector<HTMLDivElement>("#heatmap")!
const root = createRoot(host)
await act(async () => {
  root.render(<UsageHeatmap days={syntheticDays(365)} />)
})

async function runChecks() {
  const results = document.querySelector<HTMLPreElement>("#results")!
  const passed: string[] = []
  const check = (name: string, condition: unknown) => {
    if (!condition) throw new Error(name)
    passed.push(name)
  }
  const rects = () => Array.from(host.querySelectorAll<SVGRectElement>("rect[data-date]"))
  const fillOf = (rect: SVGRectElement) => rect.style.fill
  const clickMode = async (name: string) => {
    const tab = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-slot="tabs-trigger"]')).find(
      (element) => element.textContent === name,
    )
    if (!tab) throw new Error(`missing mode tab ${name}`)
    await act(async () => {
      tab.click()
    })
  }

  try {
    const title = host.querySelector("h2")
    check("title reads Token activity", title?.textContent === i18n.t("usage.heatmap.title"))
    check("three mode tabs are rendered", host.querySelectorAll('[data-slot="tabs-trigger"]').length === 3)
    check("month labels sit below the last day row", (() => {
      const labels = Array.from(host.querySelectorAll<SVGTextElement>("svg text"))
      const maxRectBottom = Math.max(...rects().map((rect) => rect.getBBox().y + rect.getBBox().height))
      return labels.length > 0 && labels.every((label) => label.getBBox().y >= maxRectBottom)
    })())
    check("weekday labels are hidden", !host.querySelector("svg text[text-anchor='start']"))
    check("a full year renders one cell per day", rects().length === 365)
    check("the rolling year is one strip, not split at New Year", host.querySelectorAll("svg").length === 1)

    const dailyFills = rects().map(fillOf)
    await clickMode(i18n.t("usage.heatmap.mode.weekly"))
    const byColumn = new Map<string, Set<string>>()
    for (const rect of rects()) {
      const column = rect.getAttribute("x")!
      byColumn.set(column, (byColumn.get(column) ?? new Set()).add(fillOf(rect)))
    }
    check("weekly mode gives every cell of a week column the same fill", Array.from(byColumn.values()).every((fills) => fills.size === 1))
    check("weekly mode changes the grid", rects().map(fillOf).some((fill, index) => fill !== dailyFills[index]))

    await clickMode(i18n.t("usage.heatmap.mode.cumulative"))
    const values = rects().map((rect) => Number(rect.dataset.value))
    check("cumulative mode never decreases", values.every((value, index) => index === 0 || value >= values[index - 1]!))
    check("cumulative cell label names the running total", rects().at(-1)?.getAttribute("aria-label")?.includes(String(values.at(-1))) === true)

    await clickMode(i18n.t("usage.heatmap.mode.daily"))
    check("returning to daily restores the original fills", rects().map(fillOf).every((fill, index) => fill === dailyFills[index]))

    results.textContent = `PASS\n${passed.map((name) => `✔ ${name}`).join("\n")}`
  } catch (error) {
    results.textContent = `FAIL\n${passed.map((name) => `✔ ${name}`).join("\n")}\n✖ ${error instanceof Error ? error.message : String(error)}`
  }
}

document.querySelector<HTMLButtonElement>("#run")!.addEventListener("click", () => {
  void runChecks()
})
if (params.has("auto")) void runChecks()
