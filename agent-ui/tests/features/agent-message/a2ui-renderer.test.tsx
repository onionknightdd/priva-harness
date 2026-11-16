import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Node", "Document", "DocumentFragment", "SVGElement", "MutationObserver", "getComputedStyle", "customElements", "CustomEvent", "Event", "ShadowRoot", "CSSStyleSheet"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
})
dom.window.matchMedia = (query) => ({ matches: query.includes("prefers-reduced-motion"), media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, onchange: null })
const hooks = registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith(".css")) return { format: "module", source: "export default {}", shortCircuit: true }
  return nextLoad(url, context)
} })
after(() => { hooks.deregister(); dom.window.close() })

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { AgentToRendererMessageSchema } = await import("@a2ui/web_core/v1_0")
const { A2uiVisual } = await import("../../../src/features/agent-message/a2ui/a2ui-visual.tsx")
type Props = React.ComponentProps<typeof A2uiVisual>
function fixture(name = "sales-dashboard") {
  const data = JSON.parse(readFileSync(new URL(`../../fixtures/a2ui/${name}.json`, import.meta.url), "utf8")) as { messages: unknown[] }
  return data.messages.map((message) => AgentToRendererMessageSchema.parse(message))
}
async function mount(props: Props) {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const render = async (next: Props) => { await act(async () => { root.render(<A2uiVisual {...next} />) }) }
  await render(props)
  return { host, render, async close() { await act(async () => root.unmount()); host.remove() } }
}
async function click(button: HTMLButtonElement) { await act(async () => button.click()) }

test("renders the real compiler dashboard through the official A2UI processor and renderer", async () => {
  const view = await mount({ messages: fixture(), onAction: () => {} })
  try {
    assert.equal(view.host.querySelector("[role='alert']"), null, view.host.textContent ?? "")
    assert.equal(view.host.querySelector("h2")?.textContent, "Q3 Sales Performance")
    assert.equal(view.host.querySelectorAll(".a2ui-stat").length, 4)
    assert.deepEqual(Array.from(view.host.querySelectorAll(".a2ui-stat-value"), (node) => node.textContent), ["$14.8M", "108%", "14.2%", "North America"])
    assert.equal(view.host.querySelectorAll(".recharts-bar-rectangle").length, 8)
    assert.equal(view.host.querySelectorAll("table.sr-only tbody tr").length, 4)
  } finally { await view.close() }
})

test("preserves structured action payload and does not dispatch during history replay", async () => {
  const actions: Parameters<NonNullable<Props["onAction"]>>[0][] = []
  const messages = fixture()
  const onAction: Props["onAction"] = (action) => { actions.push(action) }
  const view = await mount({ messages, onAction })
  try {
    assert.equal(actions.length, 0)
    const button = view.host.querySelector<HTMLButtonElement>(".a2ui-action button")!
    await click(button)
    assert.equal(actions.length, 1)
    assert.equal(actions[0].surfaceId, "main")
    assert.equal(typeof actions[0].name, "string")
    assert.equal(typeof actions[0].sourceComponentId, "string")
    assert.ok(Object.keys(actions[0].context).length > 0)
    assert.ok(Number.isFinite(Date.parse(actions[0].timestamp)))
    await view.render({ messages: fixture(), onAction })
    assert.equal(actions.length, 1)
  } finally { await view.close() }
})

test("keeps actions pending and reports delivery failure despite SDK emitter swallowing rejections", async () => {
  let rejectAction!: (error: Error) => void
  const view = await mount({ messages: fixture(), onAction: () => new Promise<void>((_resolve, reject) => { rejectAction = reject }) })
  try {
    const button = view.host.querySelector<HTMLButtonElement>(".a2ui-action button")!
    await click(button)
    assert.equal(button.disabled, true)
    assert.equal(button.getAttribute("aria-busy"), "true")
    await act(async () => rejectAction(new Error("Session is no longer available")))
    assert.match(view.host.querySelector("[role='alert']")?.textContent ?? "", /Session is no longer available/)
    assert.equal(button.disabled, false)
  } finally { await view.close() }
})

test("disables action buttons without a conversation action handler", async () => {
  const view = await mount({ messages: fixture() })
  try { assert.ok(Array.from(view.host.querySelectorAll<HTMLButtonElement>(".a2ui-action button")).every((button) => button.disabled)) }
  finally { await view.close() }
})

test("rejects unknown components and recovers when valid canonical messages replace them", async () => {
  const malformed = fixture()
  const first = malformed[0]
  assert.ok("createSurface" in first)
  const components = first.createSurface.components!
  components.find((component) => component.id === "root")!.component = "Unregistered"
  const view = await mount({ messages: malformed })
  try {
    assert.ok(view.host.querySelector("[role='alert']"))
    await view.render({ messages: fixture() })
    assert.equal(view.host.querySelector("[role='alert']"), null)
    assert.equal(view.host.querySelectorAll(".a2ui-stat").length, 4)
  } finally { await view.close() }
})

test("two-way fields dispatch resolved values and survive handler-only rerenders", async () => {
  const actions: Parameters<NonNullable<Props["onAction"]>>[0][] = []
  const messages = fixture("form-action")
  const view = await mount({ messages, onAction: (action) => { actions.push(action) } })
  try {
    const input = view.host.querySelector<HTMLInputElement>("input")!
    assert.equal(input.value, "Q3 plan")
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, "Updated Q3 plan")
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
    })
    await view.render({ messages, onAction: (action) => { actions.push(action) } })
    assert.equal(view.host.querySelector<HTMLInputElement>("input")?.value, "Updated Q3 plan")
    await click(view.host.querySelector<HTMLButtonElement>(".a2ui-action button")!)
    assert.equal(actions.length, 1)
    assert.deepEqual(actions[0].context, { title: "Updated Q3 plan", region: "Europe" })
    assert.equal(actions[0].name, "update_report")
    assert.equal(actions[0].userMessage, "Update the regional report")
    assert.equal(actions[0].sourceComponentId, "submit")
  } finally { await view.close() }
})

test("line, area and donut charts render through the registered catalog", async () => {
  for (const [kind, selector] of [["LineChart", ".recharts-line"], ["AreaChart", ".recharts-area"], ["DonutChart", ".recharts-pie-sector"]] as const) {
    const messages = fixture()
    const first = messages[0]
    assert.ok("createSurface" in first)
    const chart = first.createSurface.components!.find((component) => component.component === "BarChart")!
    chart.component = kind
    if (kind === "DonutChart") {
      chart.values = [6.1, 4.3, 3.2, 1.2]
      delete chart.series
    }
    const view = await mount({ messages })
    try {
      assert.equal(view.host.querySelector("[role='alert']"), null, view.host.textContent ?? "")
      assert.ok(view.host.querySelector(selector), `${kind} missing plotted values`)
    } finally { await view.close() }
  }
})

test("a rendering failure is cleared when the surface model is replaced", async () => {
  const malformed = fixture()
  const first = malformed[0]
  assert.ok("createSurface" in first)
  const chart = first.createSurface.components!.find((component) => component.component === "BarChart")!
  chart.labels = ["Mismatched"]
  const error = console.error
  console.error = () => {}
  const view = await mount({ messages: malformed })
  try {
    assert.match(view.host.querySelector("[role='alert']")?.textContent ?? "", /one value for every label/)
    await view.render({ messages: fixture() })
    assert.equal(view.host.querySelector("[role='alert']"), null)
    assert.equal(view.host.querySelectorAll(".a2ui-stat").length, 4)
  } finally { await view.close(); console.error = error }
})

test("select changes update bound action context", async () => {
  const actions: Parameters<NonNullable<Props["onAction"]>>[0][] = []
  const view = await mount({ messages: fixture("form-action"), onAction: (action) => { actions.push(action) } })
  try {
    await click(view.host.querySelector<HTMLButtonElement>("[role='combobox']")!)
    const option = Array.from(document.querySelectorAll<HTMLElement>("[role='option']")).find((item) => item.textContent === "Asia Pacific")!
    assert.ok(option)
    await act(async () => option.click())
    assert.match(view.host.querySelector("[role='combobox']")?.textContent ?? "", /Asia Pacific/)
    await click(view.host.querySelector<HTMLButtonElement>(".a2ui-action button")!)
    assert.deepEqual(actions[0].context, { title: "Q3 plan", region: "Asia Pacific" })
  } finally { await view.close() }
})

test("renders the compiler-generated gallery including its table", async () => {
  const view = await mount({ messages: fixture("all-charts") })
  try {
    assert.equal(view.host.querySelector("[role='alert']"), null, view.host.textContent ?? "")
    for (const selector of [".recharts-line", ".recharts-area", ".recharts-pie-sector", ".a2ui-table-scroll tbody tr"]) assert.ok(view.host.querySelector(selector))
  } finally { await view.close() }
})


test("a compiler-generated root Table preserves Chinese status beside long descriptions", async () => {
  const view = await mount({ messages: fixture("root-table") })
  try {
    assert.equal(view.host.querySelector("[role='alert']"), null, view.host.textContent ?? "")
    assert.equal(view.host.querySelectorAll(".a2ui-table-scroll thead th").length, 4)
    assert.equal(view.host.querySelectorAll(".a2ui-table-scroll tbody tr").length, 3)
    assert.deepEqual(Array.from(view.host.querySelectorAll("tbody tr td:nth-child(2)"), (cell) => cell.textContent), ["已就绪", "已连接", "已就绪"])
    assert.match(view.host.querySelector("tbody tr td:nth-child(4)")?.textContent ?? "", /documentation library/)
  } finally { await view.close() }
})
