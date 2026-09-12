import { act } from "react"
import { createRoot } from "react-dom/client"

import i18n from "../../../src/i18n"
import "../../../src/index.css"
import { UsageActivity } from "../../../src/features/usage/usage-activity"
import { UsageModelTable } from "../../../src/features/usage/usage-model-table"
import { UsageOverviewCards } from "../../../src/features/usage/usage-overview-cards"
import {
  shiftLocalDate,
  type UsageDailyModels,
  type UsageDay,
  type UsageModel,
  type UsageOverview,
  type UsageRangeSummary,
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

// The cards fetch their own range; answer from the same synthetic days so the
// numbers can be checked against the heatmap.
const rangeRequests: string[] = []
function syntheticRange(from: string, to: string): UsageRangeSummary {
  const days = overview.heatmap.filter((day) => day.date >= from && day.date <= to)
  const active = days.filter((day) => day.processedTokens > 0)
  const processedTokens = days.reduce((sum, day) => sum + day.processedTokens, 0)
  const runs = days.reduce((sum, day) => sum + day.runs, 0)
  const peak = active.reduce<UsageDay | null>((best, day) => (best === null || day.processedTokens > best.processedTokens ? day : best), null)
  let streak: UsageRangeSummary["longestStreak"] = null
  let start = 0
  for (let index = 1; index <= active.length; index += 1) {
    const previous = active[index - 1]!
    const current = active[index]
    if (current && shiftLocalDate(previous.date, 1) === current.date) continue
    const length = index - start
    if (!streak || length > streak.days) streak = { days: length, from: active[start]!.date, to: previous.date }
    start = index
  }
  return {
    from, to, days: days.length, runs, completed: Math.round(runs * 0.94), failed: runs - Math.round(runs * 0.94), aborted: 0,
    activeSessions: Math.ceil(runs / 3), activeDays: active.length, projects: Math.min(6, active.length),
    inputTokens: processedTokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, processedTokens,
    costUsd: runs === 0 ? null : Math.round(processedTokens / 1_000_000 * 150) / 100, runsWithoutCost: Math.floor(runs / 10),
    peakDay: peak ? { date: peak.date, processedTokens: peak.processedTokens } : null, longestStreak: streak,
  }
}
const realFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (url.includes("/api/sandbox/usage/range")) {
    rangeRequests.push(url)
    const params = new URL(url, location.origin).searchParams
    await new Promise((resolve) => setTimeout(resolve, 30))
    return new Response(JSON.stringify(syntheticRange(params.get("from")!, params.get("to")!)), { headers: { "Content-Type": "application/json" } })
  }
  return realFetch(input, init)
}

const host = document.querySelector<HTMLDivElement>("#heatmap")!
const root = createRoot(host)
await act(async () => {
  root.render(
    <div className="flex flex-col gap-8">
      <div data-test="cards"><UsageOverviewCards /></div>
      <div data-test="activity"><UsageActivity overview={overview} /></div>
      <div data-test="models"><UsageModelTable models={overview.models} /></div>
    </div>
  )
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
  // Scope to the activity block; the overview cards below carry their own tabs.
  const activity = host.querySelector<HTMLElement>('[data-test="activity"]')!
  const triggers = () => Array.from(activity.querySelectorAll<HTMLButtonElement>('[data-slot="tabs-trigger"]'))
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
    check("weekday labels are 10px under 12px month labels", getComputedStyle(weekdayLabels()[0]!).fontSize === "10px" && getComputedStyle(monthLabels()[0]!).fontSize === "12px")
    check("the reveal sweeps from the top-left corner along the diagonal", (() => {
      const delayOf = (rect: SVGRectElement) => Number(rect.getAnimations()[0]?.effect?.getTiming().delay ?? NaN)
      const at = (column: number, row: number) => rects().find((rect) => Math.round(Number(rect.getAttribute("x")) / 16) === column && Math.round(Number(rect.getAttribute("y")) / 16) === row)
      const origin = at(1, 0), below = at(1, 1), right = at(2, 0), far = at(2, 1)
      if (!origin || !below || !right || !far) return false
      return delayOf(below) === delayOf(right) && delayOf(below) > delayOf(origin) && delayOf(far) > delayOf(below) && delayOf(right) - delayOf(origin) === 8
    })())
    check("the reveal is over within a second", Math.max(...rects().map((rect) => {
      const timing = rect.getAnimations()[0]?.effect?.getTiming()
      return timing ? Number(timing.delay) + Number(timing.duration) : 0
    })) <= 1000)
    // Headless virtual time can freeze WAAPI mid-flight, so a cell counts when
    // it has settled or its reveal animation is still attached. The reveal is
    // then finished explicitly so geometry checks measure settled cells.
    check("every cell is revealed or still revealing", rects().every((rect) => getComputedStyle(rect).opacity === "1" || rect.getAnimations().length > 0))
    for (const rect of rects()) for (const animation of rect.getAnimations()) animation.finish()
    check("finished cells sit at full size and opacity", (() => {
      const off = rects().filter((rect) => getComputedStyle(rect).opacity !== "1" || Math.abs(rect.getBoundingClientRect().width - 12) >= 0.5)
      if (off.length === 0) return true
      const sample = off[0]!
      throw new Error(`finished cells sit at full size and opacity: ${off.length} off, e.g. opacity=${getComputedStyle(sample).opacity} width=${sample.getBoundingClientRect().width} transform=${getComputedStyle(sample).transform} animations=${sample.getAnimations().length}`)
    })())

    const hoveredCell = rects().at(-1)!
    await act(async () => {
      hoveredCell.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    })
    const tooltip = () => document.querySelector<HTMLElement>('[data-slot="tooltip-content"]')
    check("hovering a cell shows its date and tokens", await waitFor(() => {
      const text = tooltip()?.textContent ?? ""
      const [year, month, day] = hoveredCell.dataset.date!.split("-").map(Number)
      const expectedDate = i18n.language.startsWith("zh")
        ? `${year}年${month}月${day}日`
        : new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(new Date(year!, month! - 1, day))
      return text.includes(expectedDate) && text.includes(Number(hoveredCell.dataset.value).toLocaleString())
    }))
    await act(async () => {
      hoveredCell.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }))
    })
    check("leaving the grid hides the tooltip", await waitFor(() => tooltip() === null || tooltip()?.getAttribute("data-open") === null))
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
      const block = activity.querySelector('[data-slot="tabs"]')!.getBoundingClientRect()
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
    // Bars grow in over 320ms; their paths only exist once they have height.
    check("model chart has rendered its bars", await waitFor(() => host.querySelectorAll(".recharts-bar-rectangle path").length > 0))
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

    // --- overview cards ---------------------------------------------------
    const today = new Date()
    const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
    const todayIso = iso(today)
    const cardsSection = host.querySelector<HTMLElement>('[data-test="cards"] section')!
    check("the overview sits above the activity block", cardsSection.getBoundingClientRect().bottom <= activity.getBoundingClientRect().top)
    check("the Token activity tab uses the gauge icon", panelTabs[0]!.querySelector("svg.lucide-gauge") !== null)
    const cardValues = () => Array.from(cardsSection.querySelectorAll<HTMLElement>('[data-slot="card"] p:nth-child(2)')).map((node) => node.textContent)
    const pickerButtons = () => Array.from(cardsSection.querySelectorAll<HTMLButtonElement>('button[aria-label]')).filter((button) => [i18n.t("usage.overview.from"), i18n.t("usage.overview.to")].includes(button.getAttribute("aria-label")!))
    const presetTabs = () => Array.from(cardsSection.querySelectorAll<HTMLButtonElement>('[data-slot="tabs-trigger"]'))
    const dayLabel = (date: string) => {
      const [year, month, day] = date.split("-").map(Number)
      return i18n.language.startsWith("zh") ? `${year}年${month}月${day}日` : new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(new Date(year!, month! - 1, day))
    }
    check("overview renders six cards in the requested order", Array.from(cardsSection.querySelectorAll('[data-slot="card"] p:first-child')).map((node) => node.textContent).join("|") === ["tokens", "projects", "sessions", "runs", "peakDay", "longestStreak"].map((key) => i18n.t(`usage.overview.cards.${key}`)).join("|"))
    check("the default range is one year ending today", await waitFor(() => rangeRequests.some((url) => url.includes(`from=${shiftLocalDate(todayIso, -364)}&to=${todayIso}`))))
    check("the one-year preset is active and both pickers show its dates", presetTabs()[2]?.getAttribute("aria-selected") === "true" && pickerButtons().map((button) => button.textContent).join("|") === `${dayLabel(shiftLocalDate(todayIso, -364))}|${dayLabel(todayIso)}`)
    check("card values arrive from the range summary", await waitFor(() => cardValues()[0] !== i18n.t("usage.overview.none") && cardValues()[5]?.includes(String(syntheticRange(shiftLocalDate(todayIso, -364), todayIso).longestStreak?.days)) === true))
    const yearTokens = cardValues()[0]

    await act(async () => { presetTabs()[0]!.click() })
    check("choosing 7 days re-requests the last seven local days", await waitFor(() => rangeRequests.some((url) => url.includes(`from=${shiftLocalDate(todayIso, -6)}&to=${todayIso}`))))
    check("the pickers follow the preset", await waitFor(() => pickerButtons()[0]?.textContent === dayLabel(shiftLocalDate(todayIso, -6))))
    check("date buttons keep one fixed width across ranges", pickerButtons().every((button) => Math.abs(button.getBoundingClientRect().width - 128) < 0.5))
    check("date buttons are filled, not outlined", pickerButtons().every((button) => {
      const style = getComputedStyle(button)
      return style.borderTopColor === "rgba(0, 0, 0, 0)" && style.backgroundColor !== "rgba(0, 0, 0, 0)"
    }))
    check("the leaving date rolls out and only the new one remains", await waitFor(() => pickerButtons()[0]!.querySelectorAll("span span").length === 1))
    check("card values change with the range", await waitFor(() => cardValues()[0] !== yearTokens))

    await act(async () => { pickerButtons()[0]!.click() })
    const dayCell = await waitFor(() => document.querySelector(`[data-day] button, [data-day]`) !== null)
    check("the start-date picker opens a calendar", dayCell)
    // Measured once the popover's scale-in has settled.
    check("the calendar is compact: 32px day cells", await waitFor(() => {
      const cell = document.querySelector<HTMLElement>('[data-slot="popover-content"] [data-day] button')
      return cell !== null && Math.abs(cell.getBoundingClientRect().width - 32) < 0.5 && Math.abs(cell.getBoundingClientRect().height - 32) < 0.5
    }))
    const target = shiftLocalDate(todayIso, -2)
    const targetButton = document.querySelector<HTMLButtonElement>(`[data-day="${target}"] button`) ?? Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.getAttribute("aria-label")?.includes(String(Number(target.slice(-2)))) && button.closest('[data-slot="popover-content"]'))
    if (!targetButton) throw new Error("day button not found")
    await act(async () => { targetButton.click() })
    const done = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-slot="popover-content"] button')).find((button) => button.textContent === i18n.t("usage.overview.done"))
    if (!done) throw new Error("done button not found")
    await act(async () => { done.click() })
    check("picking a start date makes the range custom and deselects presets", await waitFor(() => rangeRequests.some((url) => url.includes(`from=${target}&to=${todayIso}`))) && presetTabs().every((tab) => tab.getAttribute("aria-selected") !== "true"))
    check("the start picker shows the chosen day", await waitFor(() => pickerButtons()[0]?.textContent === dayLabel(target)))

    // --- model table -------------------------------------------------------
    const table = host.querySelector<HTMLElement>('[data-test="models"] table')!
    const tableRows = Array.from(table.querySelectorAll("tbody tr"))
    const ranked = [...overview.models].sort((left, right) => right.processedTokens - left.processedTokens)
    check("model table lists the top four models then others", tableRows.map((row) => row.querySelector("td")!.textContent).join("|") === [...ranked.slice(0, 4).map((m) => m.model), i18n.t("usage.models.other")].join("|"))
    check("model table rows are 26px with right-aligned tabular numbers", tableRows.every((row) => Math.abs(row.getBoundingClientRect().height - 26) < 1) && Array.from(table.querySelectorAll("tbody td:nth-child(3)")).every((cell) => getComputedStyle(cell).textAlign === "right"))
    check("model table shares add up to the whole", (() => {
      const total = tableRows.reduce((sum, row) => sum + Number(row.querySelector("td:nth-child(2) span:last-child")!.textContent!.replace("%", "")), 0)
      return Math.abs(total - 100) <= tableRows.length
    })())
    check("model table row swatches follow the chart palette", tableRows.every((row, index) => (row.querySelector<HTMLElement>("td span span")!.style.backgroundColor || "").includes(`usage-series-${Math.min(index + 1, 5)}`)))
    check("share bars settle at their share width", await waitFor(() => tableRows.every((row) => {
      const bar = row.querySelector<HTMLElement>("td:nth-child(2) span span span")!
      const track = bar.parentElement!
      const share = Number(bar.style.getPropertyValue("--share"))
      return Math.abs(bar.getBoundingClientRect().width - track.getBoundingClientRect().width * share) < 1.5
    })))

    results.textContent = `PASS\n${passed.map((name) => `✔ ${name}`).join("\n")}`
  } catch (error) {
    results.textContent = `FAIL\n${passed.map((name) => `✔ ${name}`).join("\n")}\n✖ ${error instanceof Error ? error.message : String(error)}`
  }
}

document.querySelector<HTMLButtonElement>("#run")!.addEventListener("click", () => {
  void runChecks()
})
if (params.has("auto")) void runChecks()
