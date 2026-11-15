import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

import type { StreamBlock } from "../../../src/features/agent-message/agent-message-data.ts"

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
  pretendToBeVisual: true,
})
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "DocumentFragment", "SVGElement", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key as keyof typeof dom.window],
  })
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
  IntersectionObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
})
dom.window.matchMedia = (query) => ({
  matches: query.includes("prefers-reduced-motion"),
  media: query,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => true,
  onchange: null,
})
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) return { format: "module", source: "export default {}", shortCircuit: true }
    return nextLoad(url, context)
  },
})
after(() => {
  hooks.deregister()
  dom.window.close()
})

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { I18nextProvider, initReactI18next } = await import("react-i18next")
const i18n = (await import("i18next")).createInstance()
const { en } = await import("../../../src/i18n/locales/en.ts")
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } } })
const { readFileSync } = await import("node:fs")
const { GeneratedA2ui } = await import("../../../src/features/agent-message/generated-a2ui.tsx")
const { UiActionProvider } = await import("../../../src/features/agent-message/ui-action-context.tsx")
const { parseUiActionMessage } = await import("../../../src/features/agent-message/ui-action.ts")
const output = readFileSync(new URL("../../fixtures/a2ui/sales-dashboard.json", import.meta.url), "utf8")
type ToolBlock = Extract<StreamBlock, { type: "tool_use" }>
const block = (status: "started" | "running" | "completed", ok?: boolean, result = output): ToolBlock => ({
  type: "tool_use", id: "sale-call", blockId: "sale-call", index: 0, name: "render_ui",
  input: { source: "this source must never be executed in the browser" },
  tool: { id: "sale-call", name: "render_ui", status, ok, output: result },
})
async function mount(next: ToolBlock, onContinue?: (text: string) => void | Promise<void>) {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const render = async (value: ToolBlock) => {
    await act(async () => root.render(<I18nextProvider i18n={i18n}><UiActionProvider onContinue={onContinue}><GeneratedA2ui block={value} /></UiActionProvider></I18nextProvider>))
  }
  await render(next)
  return { host, render, async close() { await act(async () => root.unmount()); host.remove() } }
}

test("pending calls show a loading state, completed canonical output renders the dashboard", async () => {
  const view = await mount(block("started"))
  try {
    assert.ok(view.host.querySelector('[role="status"]'))
    assert.equal(view.host.textContent?.includes("source must never"), false)
    await view.render(block("completed", true))
    assert.equal(view.host.querySelector('[role="status"]'), null)
    assert.equal(view.host.querySelector('[role="alert"]'), null)
    assert.equal(view.host.querySelectorAll(".a2ui-stat").length, 4)
    assert.match(view.host.textContent ?? "", /Q3 Sales Performance/)
  } finally { await view.close() }
})

test("completed failed attempts render nothing outside the process details", async () => {
  const view = await mount(block("completed", false, "Unknown surface mcp_status"))
  try {
    assert.equal(view.host.textContent, "")
    assert.equal(view.host.querySelector('[data-slot="generated-visual"]'), null)
    assert.equal(view.host.querySelector('[role="alert"]'), null)
  } finally { await view.close() }
})

for (const status of ["started", "running"] as const) test(`an early failure flag during ${status} keeps the loading state until completion`, async () => {
  const view = await mount(block(status, false, "Unknown surface mcp_status"))
  try {
    assert.ok(view.host.querySelector('[role="status"]'))
    assert.equal(view.host.querySelector('[role="alert"]'), null)
    await view.render(block("completed", false, "Unknown surface mcp_status"))
    assert.equal(view.host.textContent, "")
  } finally { await view.close() }
})

test("malformed successful output shows an understandable inline error instead of executing source", async () => {
  const view = await mount(block("completed", true, "not JSON"))
  try {
    assert.ok(view.host.querySelector('[role="alert"]'))
    assert.equal(view.host.querySelector('[data-a2ui-surface]'), null)
    assert.equal(view.host.textContent?.includes("source must never"), false)
  } finally { await view.close() }
})

test("button passes structured context and source identity through the real continuation bridge", async () => {
  const prompts: string[] = []
  const view = await mount(block("completed", true), (text) => { prompts.push(text) })
  try {
    const button = [...view.host.querySelectorAll("button")].find((item) => item.textContent === "Explore North America")!
    assert.ok(button)
    await act(async () => button.click())
    assert.equal(prompts.length, 1)
    const parsed = parseUiActionMessage(prompts[0]!)
    assert.equal(parsed?.uiAction.toolCallId, "sale-call")
    assert.equal(parsed?.uiAction.action.name, "explore_region")
    assert.equal(parsed?.uiAction.action.sourceComponentId, "explore")
    assert.equal(parsed?.uiAction.action.surfaceId, "main")
    assert.deepEqual(parsed?.uiAction.action.context, { region: "North America", quarter: "Q3" })
    assert.ok(parsed?.uiAction.action.timestamp)
    await view.render({ ...block("completed", true) })
    assert.equal(prompts.length, 1, "history rerender must never submit another user turn")
  } finally { await view.close() }
})

test("a rendered history surface without continuation cannot submit actions", async () => {
  const view = await mount(block("completed", true))
  try {
    const buttons = [...view.host.querySelectorAll("button")]
    assert.equal(buttons.length, 2)
    assert.ok(buttons.every((button) => button.disabled))
  } finally { await view.close() }
})
