import { act } from "react"
import { createRoot } from "react-dom/client"

import i18n from "../../../src/i18n"
import "../../../src/index.css"
import { UsageActivity } from "../../../src/features/usage/usage-activity"
import type {
  UsageDailyModels,
  UsageDay,
  UsageModel,
  UsageOverview,
} from "../../../src/features/usage/usage-api"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const params = new URLSearchParams(location.search)
document.documentElement.classList.toggle("dark", params.has("dark"))
if (params.has("zh")) await i18n.changeLanguage("zh-CN")

const MODELS = ["claude-sonnet-4.5", "gpt-5", "claude-opus-4.1", "gemini-2.5-pro", "gpt-5-mini", "qwen3-coder"]

// Deterministic year of activity that ramps up over the last six months, so
// the grid shows both the empty early months and dense recent weeks.
function syntheticOverview(count: number): UsageOverview {
  const heatmap: UsageDay[] = []
  const dailyModels: UsageDailyModels[] = []
  const totals = new Map<string, number>()
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
    heatmap.push({ date: iso, runs: tokens ? 1 + (hash % 5) : 0, processedTokens: tokens })
    if (tokens) {
      const byModel: Record<string, number> = {}
      const shares = [0.5, 0.25, 0.12, 0.07, 0.04, 0.02]
      MODELS.forEach((model, index) => {
        const share = shares[(index + (hash % 2)) % shares.length]!
        const part = Math.round(tokens * share)
        byModel[model] = part
        totals.set(model, (totals.get(model) ?? 0) + part)
      })
      dailyModels.push({ date: iso, byModel })
    }
  }
  const grand = [...totals.values()].reduce((sum, value) => sum + value, 0)
  const models: UsageModel[] = MODELS.map((model) => {
    const processedTokens = totals.get(model) ?? 0
    return {
      model, runs: 0, share: grand ? processedTokens / grand : 0,
      inputTokens: processedTokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      processedTokens, costUsd: null, runsWithoutCost: 0,
    }
  })
  return {
    timeZone: "UTC", generatedAt: today.toISOString(), today: today.toISOString().slice(0, 10), retentionDays: 365,
    ranges: [], heatmap, currentStreak: 0, longestStreak: 0, peakHour: null, models, dailyModels,
    failures: [], durationP50Ms: null, durationP95Ms: null, tools: [], skills: [],
    permissions: { asked: 0, denied: 0, timedOut: 0 }, compactions: 0,
  }
}

const overview = syntheticOverview(365)
const host = document.querySelector<HTMLDivElement>("#heatmap")!
const root = createRoot(host)
await act(async () => {
  root.render(<UsageActivity overview={overview} />)
})
// `?panel=models` opens the model chart for visual inspection.
if (params.get("panel") === "models") {
  await act(async () => {
    Array.from(host.querySelectorAll<HTMLButtonElement>('[data-slot="tabs-trigger"]'))[1]?.click()
  })
}

async function runChecks() {
  const results = document.querySelector<HTMLPreElement>("#results")!
  const passed: string[] = []
  const check = (name: string, condition: unknown) => {
    if (!condition) throw new Error(name)
    passed.push(name)
  }
  const rects = () => Array.from(host.querySelectorAll<SVGRectElement>("rect[data-date]"))
  const fillOf = (rect: SVGRectElement) => rect.style.fill
  const triggers = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[data-slot="tabs-trigger"]'))
  const clickTab = async (name: string) => {
    const tab = triggers().find((element) => element.textContent === name)
    if (!tab) throw new Error(`missing tab ${name}`)
    await act(async () => {
      tab.click()
    })
  }
  const waitFor = async (condition: () => boolean, timeoutMs = 2000) => {
    const deadline = performance.now() + timeoutMs
    while (!condition()) {
      if (performance.now() > deadline) return false
      await new Promise((resolve) => setTimeout(resolve, 16))
    }
    return true
  }
  const monthLabels = () => Array.from(host.querySelectorAll<SVGTextElement>("svg text")).filter((label) => label.getAttribute("dominant-baseline") === "hanging")
  const weekdayLabels = () => Array.from(host.querySelectorAll<SVGTextElement>("svg text")).filter((label) => label.getAttribute("dominant-baseline") === "middle")
  const gridRight = () => rects().reduce((edge, rect) => Math.max(edge, rect.getBoundingClientRect().right), 0)

  try {
    const panelTabs = triggers().slice(0, 2)
    check("panel tabs read Token activity / Model activity", panelTabs.map((tab) => tab.textContent).join("|") === `${i18n.t("usage.activity.tokens")}|${i18n.t("usage.activity.models")}`)
    check("panel tabs use the default list variant like the sidebar", panelTabs[0]!.closest('[data-slot="tabs-list"]')?.getAttribute("data-variant") === "default")
    check("the mode switch uses the bare text variant", triggers()[2]!.closest('[data-slot="tabs-list"]')?.getAttribute("data-variant") === "text" && !triggers()[2]!.closest('[data-slot="tabs-list"]')!.querySelector('[data-slot="tabs-active-indicator"]:not(.hidden)'))
    check("the mode switch list has no background", getComputedStyle(triggers()[2]!.closest('[data-slot="tabs-list"]')!).backgroundColor === "rgba(0, 0, 0, 0)")
    check("three mode tabs are rendered", triggers().length === 5)
    check("weekday labels run Monday to Sunday", weekdayLabels().map((label) => label.textContent).join(",") === ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((key) => i18n.t(`usage.heatmap.weekday.${key}`)).join(","))
    check("month labels sit below the last day row", (() => {
      const maxRectBottom = Math.max(...rects().map((rect) => rect.getBBox().y + rect.getBBox().height))
      return monthLabels().length > 0 && monthLabels().every((label) => label.getBBox().y >= maxRectBottom)
    })())
    check("the current month is labelled and stays inside the grid", (() => {
      const last = monthLabels().at(-1)!
      const today = new Date()
      const expected = new Intl.DateTimeFormat(i18n.language.startsWith("zh") ? "zh-CN" : "en-US", { month: "short" }).format(today)
      return last.textContent === expected && last.getBoundingClientRect().right <= gridRight() + 1
    })())
    check("a full year renders one cell per day", rects().length === 365)
    check("the rolling year is one strip, not split at New Year", host.querySelectorAll('[data-slot="calendar-heatmap-body"] svg').length === 1)
    check("mode tab text ends on the grid's right edge", (() => {
      const text = triggers()[4]!
      const padding = parseFloat(getComputedStyle(text).paddingRight)
      return Math.abs(text.getBoundingClientRect().right - padding - gridRight()) <= 1
    })())
    check("panel tabs start on the weekday labels' left edge", Math.abs(panelTabs[0]!.closest('[data-slot="tabs-list"]')!.getBoundingClientRect().left - host.querySelector('[data-slot="calendar-heatmap-body"] svg')!.getBoundingClientRect().left) <= 1)
    check("the block is centred in its container", (() => {
      const block = host.firstElementChild!.getBoundingClientRect()
      const container = host.getBoundingClientRect()
      return Math.abs((block.left - container.left) - (container.right - block.right)) <= 1 && block.width < container.width
    })())

    const dailyFills = rects().map(fillOf)
    await clickTab(i18n.t("usage.heatmap.mode.weekly"))
    const byColumn = new Map<string, Set<string>>()
    for (const rect of rects()) {
      const column = rect.getAttribute("x")!
      byColumn.set(column, (byColumn.get(column) ?? new Set()).add(fillOf(rect)))
    }
    check("weekly mode gives every cell of a week column the same fill", Array.from(byColumn.values()).every((fills) => fills.size === 1))
    check("weekly mode changes the grid", rects().map(fillOf).some((fill, index) => fill !== dailyFills[index]))

    await clickTab(i18n.t("usage.heatmap.mode.cumulative"))
    const values = rects().map((rect) => Number(rect.dataset.value))
    check("cumulative mode never decreases", values.every((value, index) => index === 0 || value >= values[index - 1]!))
    check("cumulative cell label names the running total", rects().at(-1)?.getAttribute("aria-label")?.includes(String(values.at(-1))) === true)

    await clickTab(i18n.t("usage.heatmap.mode.daily"))
    check("returning to daily restores the original fills", rects().map(fillOf).every((fill, index) => fill === dailyFills[index]))

    await clickTab(i18n.t("usage.activity.models"))
    check("model panel unmounts the heatmap", rects().length === 0)
    check("model panel hides the heatmap mode switch", triggers().length === 2)
    check("model chart has rendered its bars", await waitFor(() => host.querySelectorAll(".recharts-bar-rectangle").length > 0))
    check("model chart stacks the top four models plus others", (() => {
      const text = host.querySelector(".recharts-legend-wrapper")?.textContent ?? ""
      const ranked = [...overview.models].sort((left, right) => right.processedTokens - left.processedTokens).map((model) => model.model)
      return ranked.slice(0, 4).every((model) => text.includes(model)) && ranked.slice(4).every((model) => !text.includes(model)) && text.includes(i18n.t("usage.models.other"))
    })())
    check("model chart draws twelve or thirteen monthly columns", (() => {
      const ticks = host.querySelectorAll(".recharts-cartesian-axis-tick")
      return ticks.length >= 12 && ticks.length <= 13
    })())
    check("model chart bars use the shared series tokens", Array.from(host.querySelectorAll<SVGPathElement>(".recharts-bar-rectangle path")).some((path) => path.getAttribute("fill")?.includes("--color-series1")))

    await clickTab(i18n.t("usage.activity.tokens"))
    check("returning to the heatmap restores the grid and the mode switch", rects().length === 365 && triggers().length === 5)

    results.textContent = `PASS\n${passed.map((name) => `✔ ${name}`).join("\n")}`
  } catch (error) {
    results.textContent = `FAIL\n${passed.map((name) => `✔ ${name}`).join("\n")}\n✖ ${error instanceof Error ? error.message : String(error)}`
  }
}

document.querySelector<HTMLButtonElement>("#run")!.addEventListener("click", () => {
  void runChecks()
})
if (params.has("auto")) void runChecks()
