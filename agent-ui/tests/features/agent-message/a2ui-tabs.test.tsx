import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "Document", "DocumentFragment", "SVGElement", "MutationObserver", "getComputedStyle", "customElements", "CustomEvent", "Event", "ShadowRoot", "CSSStyleSheet"]) {
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
dom.window.HTMLElement.prototype.scrollBy = () => {}
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
function fixture() {
  const data = JSON.parse(readFileSync(new URL("../../fixtures/a2ui/tabs.json", import.meta.url), "utf8")) as { messages: unknown[] }
  return data.messages.map((message) => AgentToRendererMessageSchema.parse(message))
}
async function mount(props: Props) {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const render = async (next: Props) => { await act(async () => { root.render(<A2uiVisual {...next} />) }) }
  await render(props)
  return { host, render, async close() { await act(async () => root.unmount()); host.remove() } }
}
function tabs(host: HTMLElement) { return Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')) }
function panels(host: HTMLElement) { return Array.from(host.querySelectorAll<HTMLElement>('[role="tabpanel"]')) }
function activePanel(host: HTMLElement) { return panels(host).filter((panel) => !panel.hidden) }
async function select(tab: HTMLButtonElement) {
  await act(async () => {
    tab.dispatchEvent(new dom.window.PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }))
    tab.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true, button: 0 }))
    tab.click()
  })
}
async function key(tab: HTMLButtonElement, value: string) {
  await act(async () => {
    tab.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: value, bubbles: true }))
    // Radix moves focus after the key event has propagated.
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
}

test("compiled Tabs render all children and expose exactly one accessible panel", async () => {
  const view = await mount({ messages: fixture() })
  try {
    assert.equal(view.host.querySelector('[role="alert"]'), null, view.host.textContent ?? "")
    const triggers = tabs(view.host)
    const content = panels(view.host)
    assert.deepEqual(triggers.map((tab) => tab.textContent), ["Overview", "Regions", "Report"])
    assert.equal(content.length, 3)
    assert.equal(activePanel(view.host).length, 1)
    assert.equal(triggers[0].getAttribute("aria-selected"), "true")
    for (const [index, tab] of triggers.entries()) {
      assert.equal(tab.getAttribute("aria-controls"), content[index].id)
      assert.equal(content[index].getAttribute("aria-labelledby"), tab.id)
      assert.equal(content[index].hidden, index !== 0)
      assert.equal(content[index].hasAttribute("inert"), index !== 0)
      assert.equal(content[index].tabIndex, index === 0 ? 0 : -1)
    }
    assert.ok(content[0].querySelector(".recharts-line"), "Overview chart must use the real catalog")
    assert.ok(content[1].querySelector("table"), "The hidden region table must remain mounted")
    assert.ok(content[2].querySelector("input"), "The hidden report form must remain mounted")
  } finally { await view.close() }
})

test("switching Tabs preserves form DOM, bound values and selection across handler rerenders", async () => {
  const actions: Parameters<NonNullable<Props["onAction"]>>[0][] = []
  const messages = fixture()
  const view = await mount({ messages, onAction: (action) => { actions.push(action) } })
  try {
    const triggers = tabs(view.host)
    const content = panels(view.host)
    await select(triggers[2])
    const input = content[2].querySelector<HTMLInputElement>("input")!
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, "Updated from Tabs")
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
    })
    await select(triggers[0])
    assert.equal(input.isConnected, true)
    assert.equal(content[2].hidden, true)
    await select(triggers[1])
    await select(triggers[2])
    await view.render({ messages, onAction: (action) => { actions.push(action) } })
    assert.equal(view.host.querySelector("input"), input)
    assert.equal(input.value, "Updated from Tabs")
    assert.equal(tabs(view.host)[2].getAttribute("aria-selected"), "true")
    assert.deepEqual(activePanel(view.host), [content[2]])
    assert.equal(actions.length, 0, "Local navigation must not send an agent action")
    await act(async () => content[2].querySelector<HTMLButtonElement>(".a2ui-action button")!.click())
    assert.equal(actions.length, 1)
    assert.equal(actions[0].name, "update_report")
    assert.deepEqual(actions[0].context, { title: "Updated from Tabs", region: "Europe" })
  } finally { await view.close() }
})

test("keyboard navigation changes the active panel while retaining focus and roving tab stops", async () => {
  const view = await mount({ messages: fixture() })
  try {
    const triggers = tabs(view.host)
    await act(async () => triggers[0].focus())
    await key(triggers[0], "ArrowRight")
    assert.equal(document.activeElement, triggers[1])
    assert.equal(triggers[1].getAttribute("aria-selected"), "true")
    assert.equal(activePanel(view.host)[0].id, triggers[1].getAttribute("aria-controls"))
    await key(triggers[1], "End")
    assert.equal(document.activeElement, triggers[2])
    assert.equal(triggers[2].getAttribute("aria-selected"), "true")
    await key(triggers[2], "ArrowRight")
    assert.equal(document.activeElement, triggers[0])
    assert.equal(triggers[0].getAttribute("aria-selected"), "true")
    assert.deepEqual(triggers.map((tab) => tab.tabIndex), [0, -1, -1])
    assert.equal(activePanel(view.host).length, 1)
  } finally { await view.close() }
})

test("history without an action handler still allows local Tabs navigation", async () => {
  const view = await mount({ messages: fixture() })
  try {
    const triggers = tabs(view.host)
    await select(triggers[2])
    assert.equal(triggers[2].disabled, false)
    assert.equal(activePanel(view.host)[0].id, triggers[2].getAttribute("aria-controls"))
    assert.equal(view.host.querySelector<HTMLButtonElement>(".a2ui-action button")!.disabled, true)
    await select(triggers[0])
    assert.equal(activePanel(view.host).length, 1)
  } finally { await view.close() }
})
