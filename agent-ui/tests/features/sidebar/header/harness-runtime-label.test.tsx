import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

import type { HarnessId } from "../../../../src/features/sidebar/header/harness-options.ts"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "SVGElement", "DOMRect", "getComputedStyle"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
})

let reducedMotion = true
const mediaListeners = new Set<() => void>()
dom.window.matchMedia = (query) => ({
  get matches() { return query === "(prefers-reduced-motion)" && reducedMotion },
  media: query, onchange: null,
  addListener: (listener) => mediaListeners.add(listener as () => void),
  removeListener: (listener) => mediaListeners.delete(listener as () => void),
  addEventListener: (_event, listener) => mediaListeners.add(listener as () => void),
  removeEventListener: (_event, listener) => mediaListeners.delete(listener as () => void),
  dispatchEvent: () => true,
})

const observers = new Set<MeasuredResizeObserver>()
class MeasuredResizeObserver {
  readonly elements = new Set<Element>()
  constructor(readonly callback: ResizeObserverCallback) { observers.add(this) }
  observe(element: Element) { this.elements.add(element) }
  unobserve(element: Element) { this.elements.delete(element) }
  disconnect() { this.elements.clear(); observers.delete(this) }
}
Object.assign(globalThis, { ResizeObserver: MeasuredResizeObserver })

let viewportWidth = 160
let fontScale = 1
const originalRect = dom.window.HTMLElement.prototype.getBoundingClientRect
dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
  if (this.dataset.slot === "harness-runtime-label") return new DOMRect(0, 0, viewportWidth, 16)
  if (this.dataset.slot === "harness-runtime-measurement") {
    const iconWidth = this.querySelector("img")!.classList.contains("size-3") ? 12 : 14
    return new DOMRect(0, 0, iconWidth + 4 + Array.from(this.textContent!).length * 7 * fontScale, 16)
  }
  return originalRect.call(this)
}

// Node renders the real component with deterministic geometry and static asset URLs.
const hooks = registerHooks({
  load: (url, context, nextLoad) => url.endsWith(".svg")
    ? { format: "module", source: `export default ${JSON.stringify(url)}`, shortCircuit: true }
    : nextLoad(url, context),
})
after(() => { hooks.deregister(); dom.window.close() })

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { HarnessRuntimeLabel } = await import("../../../../src/features/sidebar/header/harness-runtime-label.tsx")

async function mount(width: number, harnessId: HarnessId = "claude", name = "Claude Agent SDK", reduce = true) {
  viewportWidth = width
  fontScale = 1
  reducedMotion = reduce
  mediaListeners.forEach((listener) => listener())
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const update = async (id: HarnessId, label: string) => {
    await act(async () => root.render(<React.StrictMode><HarnessRuntimeLabel harnessId={id} name={label} /></React.StrictMode>))
  }
  await update(harnessId, name)
  return {
    host,
    update,
    content: () => host.querySelector<HTMLElement>("[data-runtime-logo]")!,
    name: () => host.querySelector<HTMLElement>("[data-runtime-logo] > span[aria-hidden]")!,
    measure: () => host.querySelector<HTMLElement>('[data-slot="harness-runtime-measurement"]')!,
    async resize(width: number) {
      viewportWidth = width
      await act(async () => {
        for (const observer of observers) observer.callback([], observer as unknown as ResizeObserver)
      })
    },
    async close() { await act(async () => root.unmount()); host.remove() },
  }
}

const settle = async (milliseconds = 40) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, milliseconds)) }) }

test("shows the complete name when it fits, including the exact fractional boundary", async () => {
  const view = await mount(160)
  try {
    assert.equal(view.name().getAttribute("aria-hidden"), "false")
    assert.equal(view.name().textContent, "Claude Agent SDK")
    assert.equal(view.content().querySelectorAll("img").length, 1)
    assert.equal(view.content().querySelector(".truncate, .text-ellipsis"), null)

    fontScale = 1.003
    const width = view.measure().getBoundingClientRect().width
    await view.resize(width)
    assert.equal(view.name().getAttribute("aria-hidden"), "false")
    await view.resize(width - 0.25)
    assert.equal(view.name().getAttribute("aria-hidden"), "true")
  } finally { await view.close() }
})

test("keeps the icon while narrow and restores the name without using the collapsed width", async () => {
  const view = await mount(25)
  try {
    const icon = view.content().querySelector("img")
    assert.equal(view.name().getAttribute("aria-hidden"), "true")
    for (let index = 0; index < 3; index++) {
      await view.resize(25)
      assert.equal(view.name().getAttribute("aria-hidden"), "true")
    }
    await view.resize(160)
    assert.equal(view.name().getAttribute("aria-hidden"), "false")
    assert.equal(view.content().querySelector("img"), icon)
    assert.equal(view.measure().textContent, "Claude Agent SDK")
  } finally { await view.close() }
})

test("recalculates for a different harness or localized name without a resize event", async () => {
  const view = await mount(60, "pi", "Pi")
  try {
    assert.equal(view.name().getAttribute("aria-hidden"), "false")
    await view.update("claude", "Claude Agent SDK")
    await settle()
    assert.equal(view.name().getAttribute("aria-hidden"), "true")
    assert.equal(view.name().textContent, "Claude Agent SDK")
    await view.update("claude", "运行时")
    assert.equal(view.name().getAttribute("aria-hidden"), "false")
    assert.equal(view.name().textContent, "运行时")
  } finally { await view.close() }
})

test("tracks font metric changes even while the name is hidden", async () => {
  const view = await mount(150)
  try {
    fontScale = 1.5
    await view.resize(150)
    assert.equal(view.name().getAttribute("aria-hidden"), "true")
    fontScale = 1
    await view.resize(150)
    assert.equal(view.name().getAttribute("aria-hidden"), "false")
  } finally { await view.close() }
})

test("uses the final collapsed and expanded states immediately with reduced motion", async () => {
  const view = await mount(160)
  try {
    await view.resize(25)
    await settle()
    assert.equal(view.name().style.gridTemplateColumns, "0fr")
    assert.equal(view.name().style.opacity, "0")
    await view.resize(160)
    await settle()
    assert.equal(view.name().style.gridTemplateColumns, "1fr")
    assert.equal(view.name().style.opacity, "1")
  } finally { await view.close() }
})

test("retargets a running collapse when space returns", async () => {
  const view = await mount(160, "claude", "Claude Agent SDK", false)
  try {
    await settle(320)
    const icon = view.content().querySelector("img")
    await view.resize(25)
    await settle()
    await view.resize(160)
    await settle(320)
    assert.equal(view.name().getAttribute("aria-hidden"), "false")
    assert.equal(view.name().style.gridTemplateColumns, "1fr")
    assert.equal(view.name().style.opacity, "1")
    assert.equal(view.content().querySelector("img"), icon)
  } finally { await view.close() }
})

test("cleans up measurements on updates and unmount, including StrictMode", async () => {
  const view = await mount(160)
  try {
    assert.equal(observers.size, 1)
    assert.equal([...observers][0].elements.size, 2)
    await view.update("pi", "Pi")
    assert.equal(observers.size, 1)
    assert.equal([...observers][0].elements.size, 2)
  } finally { await view.close() }
  assert.equal(observers.size, 0)
})
