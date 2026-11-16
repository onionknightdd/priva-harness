import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLImageElement", "HTMLButtonElement", "Element", "Node", "Document", "DocumentFragment", "SVGElement", "MutationObserver", "getComputedStyle", "customElements", "CustomEvent", "Event", "ShadowRoot", "CSSStyleSheet"]) {
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
const { default: i18n } = await import("../../../src/i18n/index.ts")
await i18n.changeLanguage("en")
const { AgentToRendererMessageSchema } = await import("@a2ui/web_core/v1_0")
const { A2uiVisual } = await import("../../../src/features/agent-message/a2ui/a2ui-visual.tsx")
const { DashboardImage } = await import("../../../src/features/agent-message/a2ui/image.tsx")
const { DashboardIcon } = await import("../../../src/features/agent-message/a2ui/icons.tsx")
const { DASHBOARD_ICON_NAMES } = await import("../../../src/features/agent-message/a2ui/icon-names.ts")

function fixture() {
  const data = JSON.parse(readFileSync(new URL("../../fixtures/a2ui/media.json", import.meta.url), "utf8")) as { messages: unknown[] }
  return data.messages.map((message) => AgentToRendererMessageSchema.parse(message))
}
async function mount(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const render = async (next: React.ReactNode) => { await act(async () => { root.render(next) }) }
  await render(node)
  return { host, render, async close() { await act(async () => root.unmount()); host.remove() } }
}
async function imageEvent(image: HTMLImageElement, type: "load" | "error") {
  if (type === "load") {
    Object.defineProperties(image, { naturalWidth: { configurable: true, value: 1200 }, naturalHeight: { configurable: true, value: 700 } })
  }
  await act(async () => image.dispatchEvent(new dom.window.Event(type)))
}

test("canonical media renders bound sources, descriptions and accessible Lucide icons through the official renderer", async () => {
  const view = await mount(<A2uiVisual messages={fixture()} />)
  try {
    assert.equal(view.host.querySelector('[role="alert"]'), null, view.host.textContent ?? "")
    const images = Array.from(view.host.querySelectorAll<HTMLImageElement>(".a2ui-image img"))
    assert.equal(images.length, 2)
    const local = new URL(images[0].src)
    assert.equal(local.pathname, "/api/sandbox/files/download")
    assert.equal(local.searchParams.get("path"), "/a2ui-media-fixtures/landscape.svg")
    assert.equal(images[0].alt, "Illustrative landscape orientation image")
    assert.equal(images[0].closest(".a2ui-image")?.getAttribute("data-fit"), "contain")
    assert.equal(images[1].src, "http://127.0.0.1:5188/a2ui-media-fixtures/portrait.svg")
    assert.equal(images[1].alt, "Illustrative portrait orientation image")
    assert.equal(images[1].closest(".a2ui-image")?.getAttribute("data-fit"), "cover")
    const icons = Array.from(view.host.querySelectorAll("svg.a2ui-icon"))
    assert.equal(icons.length, 4)
    assert.equal(icons[0].getAttribute("aria-hidden"), "true")
    assert.equal(icons[0].hasAttribute("role"), false)
    assert.equal(icons[1].getAttribute("role"), "img")
    assert.equal(icons[1].getAttribute("aria-label"), "Revenue is increasing")
    assert.equal(icons[1].hasAttribute("aria-hidden"), false)
    assert.deepEqual(icons.map((icon) => icon.getAttribute("width")), ["16", "20", "32", "20"])
    assert.deepEqual(icons.map((icon) => icon.getAttribute("data-tone")), ["muted", "positive", "negative", "default"])
  } finally { await view.close() }
})

test("local image loading, failure and retry expose localized states and enable preview only after load", async () => {
  const view = await mount(<DashboardImage url="sandbox:/a2ui-media-fixtures/retry.svg" description="Local illustration" />)
  try {
    const first = view.host.querySelector<HTMLImageElement>("img")!
    const button = view.host.querySelector<HTMLButtonElement>("button")!
    assert.equal(button.disabled, true)
    assert.equal(button.getAttribute("aria-busy"), "true")
    assert.match(view.host.textContent ?? "", /loading/i)
    await imageEvent(first, "error")
    assert.equal(view.host.querySelector(".a2ui-image")?.getAttribute("data-state"), "error")
    assert.ok(view.host.querySelector('[role="alert"]')?.textContent)
    assert.equal(view.host.querySelector("img"), null)
    await act(async () => view.host.querySelector<HTMLButtonElement>("button")!.click())
    const retried = view.host.querySelector<HTMLImageElement>("img")!
    assert.notEqual(retried, first)
    assert.equal(new URL(retried.src).searchParams.get("retry"), "1")
    assert.equal(new URL(retried.src).searchParams.get("path"), "/a2ui-media-fixtures/retry.svg")
    assert.equal(view.host.querySelector(".a2ui-image")?.getAttribute("data-state"), "loading")
    await imageEvent(retried, "load")
    const loadedButton = view.host.querySelector<HTMLButtonElement>("button")!
    assert.equal(loadedButton.disabled, false)
    assert.equal(loadedButton.getAttribute("aria-busy"), "false")
    assert.match(loadedButton.getAttribute("aria-label") ?? "", /Local illustration/)
    assert.equal(view.host.querySelector(".a2ui-image")?.getAttribute("data-state"), "ready")
    assert.equal(view.host.querySelector('[role="alert"]'), null)
  } finally { await view.close() }
})

test("remote retry remounts the image without modifying a signed URL", async () => {
  const signed = "https://images.example.test/plot.svg?signature=a%2Bb%2Fc&expires=2000000000"
  const view = await mount(<DashboardImage url={signed} description="Signed image" />)
  try {
    const first = view.host.querySelector<HTMLImageElement>("img")!
    await imageEvent(first, "error")
    await act(async () => view.host.querySelector<HTMLButtonElement>("button")!.click())
    const retried = view.host.querySelector<HTMLImageElement>("img")!
    assert.notEqual(retried, first)
    assert.equal(retried.getAttribute("src"), signed)
    assert.equal(retried.getAttribute("referrerpolicy"), "no-referrer")
  } finally { await view.close() }
})

test("changing image source resets ready and error states rather than inheriting stale previews", async () => {
  const view = await mount(<DashboardImage url="https://images.example.test/first.svg" description="First" />)
  try {
    const first = view.host.querySelector<HTMLImageElement>("img")!
    await imageEvent(first, "load")
    await view.render(<DashboardImage url="https://images.example.test/second.svg" description="Second" />)
    const second = view.host.querySelector<HTMLImageElement>("img")!
    assert.notEqual(second, first)
    assert.equal(second.alt, "Second")
    assert.equal(view.host.querySelector(".a2ui-image")?.getAttribute("data-state"), "loading")
    assert.equal(view.host.querySelector<HTMLButtonElement>("button")!.disabled, true)
    await imageEvent(second, "error")
    await view.render(<DashboardImage url="https://images.example.test/third.svg" description="Third" />)
    assert.equal(view.host.querySelector('[role="alert"]'), null)
    assert.equal(view.host.querySelector<HTMLImageElement>("img")?.alt, "Third")
    assert.equal(view.host.querySelector(".a2ui-image")?.getAttribute("data-state"), "loading")
  } finally { await view.close() }
})

test("unsafe image sources are rejected before any image source reaches the DOM", async () => {
  const previousError = console.error
  console.error = () => {}
  try {
    for (const source of ["javascript:alert(1)", "data:image/svg+xml,<svg/>", "file:///private/image.png", "../relative.png"]) {
      const messages = fixture()
      const create = messages.find((message) => "createSurface" in message)!
      if (!("createSurface" in create)) throw new Error("Missing media surface")
      create.createSurface.components!.find((component) => component.id === "localImage")!.url = source
      const errors: string[] = []
      const view = await mount(<A2uiVisual messages={messages} onError={(error) => { errors.push(error) }} />)
      try {
        assert.match(view.host.querySelector('[role="alert"]')?.textContent ?? "", /Image.url|HTTP|sandbox/)
        assert.equal(view.host.querySelector("img"), null)
        assert.ok(errors.length > 0)
      } finally { await view.close() }
    }
  } finally { console.error = previousError }
})

test("every advertised icon has a real SVG mapping and whitespace labels remain decorative", async () => {
  const view = await mount(<>{DASHBOARD_ICON_NAMES.map((name) => <DashboardIcon key={name} name={name} label={name} />)}<DashboardIcon name="info" label="   " /></>)
  try {
    const icons = Array.from(view.host.querySelectorAll("svg.a2ui-icon"))
    assert.equal(icons.length, DASHBOARD_ICON_NAMES.length + 1)
    for (const [index, name] of DASHBOARD_ICON_NAMES.entries()) {
      assert.equal(icons[index].getAttribute("aria-label"), name)
      assert.ok(icons[index].childElementCount > 0, `${name} must contain SVG geometry`)
      assert.equal(icons[index].getAttribute("focusable"), "false")
    }
    assert.equal(icons.at(-1)!.getAttribute("aria-hidden"), "true")
    assert.equal(icons.at(-1)!.hasAttribute("aria-label"), false)
  } finally { await view.close() }
})
