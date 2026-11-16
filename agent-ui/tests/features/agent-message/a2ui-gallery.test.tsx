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
dom.window.HTMLElement.prototype.scrollBy = () => {}
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
const { DashboardImageGallery } = await import("../../../src/features/agent-message/a2ui/gallery.tsx")

const localImage = { url: "sandbox:/a2ui-media-fixtures/landscape.svg", description: "Local landscape", title: "Landscape" }
const remoteImage = { url: "https://images.example.test/portrait.svg?signature=a%2Bb%2Fc", description: "Remote portrait", title: "Portrait" }

function fixture() {
  const data = JSON.parse(readFileSync(new URL("../../fixtures/a2ui/gallery.json", import.meta.url), "utf8")) as { messages: unknown[] }
  return data.messages.map((message) => AgentToRendererMessageSchema.parse(message))
}
async function mount(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const render = async (next: React.ReactNode) => { await act(async () => { root.render(next) }) }
  await render(node)
  return { host, render, async close() { await act(async () => root.unmount()); host.remove() } }
}
async function click(button: HTMLButtonElement) { await act(async () => button.click()) }
async function key(element: HTMLElement, value: string) {
  await act(async () => element.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: value, bubbles: true })))
}
async function select(tab: HTMLButtonElement) {
  await act(async () => {
    tab.dispatchEvent(new dom.window.PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }))
    tab.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true, button: 0 }))
    tab.click()
  })
}
async function imageEvent(image: HTMLImageElement, type: "load" | "error") {
  if (type === "load") Object.defineProperties(image, { naturalWidth: { configurable: true, value: 1200 }, naturalHeight: { configurable: true, value: 700 } })
  await act(async () => image.dispatchEvent(new dom.window.Event(type)))
}
function gallery(host: HTMLElement) { return host.querySelector<HTMLElement>(".a2ui-gallery")! }
function index(host: HTMLElement) { return Number(gallery(host).dataset.index) }
function navigation(host: HTMLElement, direction: "previous" | "next") {
  return host.querySelector<HTMLButtonElement>(`.a2ui-gallery button[data-direction="${direction}"]`)!
}
function activeImage(host: HTMLElement) { return host.querySelector<HTMLImageElement>('.a2ui-gallery-slide[data-active="true"] img')! }

test("canonical gallery renders bound titles and image sources through the official A2UI renderer", async () => {
  const view = await mount(<A2uiVisual messages={fixture()} />)
  try {
    assert.equal(view.host.querySelector('[role="alert"]'), null, view.host.textContent ?? "")
    assert.equal(gallery(view.host).dataset.count, "3")
    assert.equal(index(view.host), 0)
    assert.match(gallery(view.host).textContent ?? "", /Illustrative image gallery/)
    const images = Array.from(view.host.querySelectorAll<HTMLImageElement>(".a2ui-gallery-slide img"))
    assert.equal(images.length, 3)
    assert.equal(new URL(images[0].src).searchParams.get("path"), "/a2ui-media-fixtures/landscape.svg")
    assert.equal(images[1].src, "http://127.0.0.1:5188/a2ui-media-fixtures/portrait.svg")
    assert.equal(images[1].alt, "Illustrative portrait orientation image")
    assert.equal(view.host.querySelectorAll('.a2ui-gallery-slide[data-active="true"]').length, 1)
    assert.equal(navigation(view.host, "previous").disabled, true)
    assert.equal(navigation(view.host, "next").disabled, false)
    assert.match(view.host.querySelector(".a2ui-gallery-caption")!.textContent ?? "", /Landscape/)
  } finally { await view.close() }
})

test("gallery navigation clamps at boundaries, updates the caption, and never emits agent actions", async () => {
  const actions: unknown[] = []
  const view = await mount(<A2uiVisual messages={fixture()} onAction={(action) => { actions.push(action) }} />)
  try {
    await click(navigation(view.host, "previous"))
    assert.equal(index(view.host), 0)
    await click(navigation(view.host, "next"))
    assert.equal(index(view.host), 1)
    assert.match(view.host.querySelector(".a2ui-gallery-caption")!.textContent ?? "", /Portrait/)
    await click(navigation(view.host, "next"))
    assert.equal(index(view.host), 2)
    assert.equal(navigation(view.host, "next").disabled, true)
    await click(navigation(view.host, "next"))
    assert.equal(index(view.host), 2)
    await key(gallery(view.host), "Home")
    assert.equal(index(view.host), 0)
    await key(gallery(view.host), "End")
    assert.equal(index(view.host), 2)
    await key(gallery(view.host), "ArrowLeft")
    assert.equal(index(view.host), 1)
    await key(gallery(view.host), "ArrowRight")
    assert.equal(index(view.host), 2)
    assert.equal(actions.length, 0)
  } finally { await view.close() }
})

test("inactive slides remain outside the tab order and selecting one does not open its lightbox", async () => {
  const view = await mount(<A2uiVisual messages={fixture()} />)
  try {
    const slides = Array.from(view.host.querySelectorAll<HTMLElement>(".a2ui-gallery-slide"))
    for (const image of view.host.querySelectorAll<HTMLImageElement>(".a2ui-gallery-slide img")) await imageEvent(image, "load")
    for (const slide of slides.slice(1)) {
      assert.equal(slide.getAttribute("aria-hidden"), "true")
      assert.equal(slide.querySelector<HTMLButtonElement>(".a2ui-image-frame")!.tabIndex, -1)
    }
    await click(slides[1].querySelector<HTMLButtonElement>(".a2ui-image-frame")!)
    assert.equal(index(view.host), 1)
    assert.equal(document.querySelector('[role="dialog"]'), null)
    assert.equal(slides[1].querySelector<HTMLButtonElement>(".a2ui-image-frame")!.tabIndex, 0)
  } finally { await view.close() }
})

test("single-image galleries keep preview available without redundant navigation controls", async () => {
  const view = await mount(<DashboardImageGallery title="One image" images={[localImage]} />)
  try {
    assert.equal(gallery(view.host).dataset.count, "1")
    assert.equal(view.host.querySelector("[data-direction]"), null)
    await key(gallery(view.host), "End")
    await key(gallery(view.host), "ArrowRight")
    await key(gallery(view.host), "Home")
    assert.equal(index(view.host), 0)
    await imageEvent(activeImage(view.host), "load")
    assert.equal(view.host.querySelector<HTMLButtonElement>(".a2ui-image-frame")!.disabled, false)
  } finally { await view.close() }
})

test("Tabs preserve gallery selection and loaded image DOM without dispatching actions", async () => {
  const actions: unknown[] = []
  const messages = fixture()
  const view = await mount(<A2uiVisual messages={messages} onAction={(action) => { actions.push(action) }} />)
  try {
    await click(navigation(view.host, "next"))
    const retainedGallery = gallery(view.host)
    const retainedImage = activeImage(view.host)
    await imageEvent(retainedImage, "load")
    const tabs = Array.from(view.host.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    await select(tabs[1])
    assert.ok(retainedGallery.closest('[hidden][inert]'))
    await select(tabs[0])
    await view.render(<A2uiVisual messages={messages} onAction={(action) => { actions.push(action) }} />)
    assert.equal(gallery(view.host), retainedGallery)
    assert.equal(activeImage(view.host), retainedImage)
    assert.equal(index(view.host), 1)
    assert.equal(retainedImage.closest(".a2ui-image")!.getAttribute("data-state"), "ready")
    assert.equal(actions.length, 0)
  } finally { await view.close() }
})

test("gallery image errors are recoverable and remote retries preserve signed source URLs", async () => {
  const view = await mount(<DashboardImageGallery images={[remoteImage, localImage]} />)
  try {
    const first = activeImage(view.host)
    await imageEvent(first, "error")
    const active = view.host.querySelector<HTMLElement>('.a2ui-gallery-slide[data-active="true"]')!
    assert.equal(active.querySelector('[role="alert"]')!.textContent, i18n.t("agentMessage.imageTools.loadFailed"))
    await click(active.querySelector<HTMLButtonElement>("button")!)
    const retried = activeImage(view.host)
    assert.notEqual(retried, first)
    assert.equal(retried.getAttribute("src"), remoteImage.url)
    await imageEvent(retried, "load")
    assert.equal(active.querySelector<HTMLButtonElement>(".a2ui-image-frame")!.disabled, false)
    assert.equal(index(view.host), 0)
    await click(navigation(view.host, "next"))
    assert.equal(index(view.host), 1)
  } finally { await view.close() }
})

test("invalid gallery sources fail at the renderer boundary before becoming image URLs", async () => {
  const previousError = console.error
  console.error = () => {}
  try {
    for (const source of ["javascript:alert(1)", "data:image/svg+xml,<svg/>", "file:///private/gallery.png"]) {
      const messages = fixture()
      const create = messages.find((message) => "createSurface" in message)!
      if (!("createSurface" in create)) throw new Error("Missing gallery surface")
      const component = create.createSurface.components!.find((component) => component.component === "ImageGallery")!
      const images = component.images as { url: unknown }[]
      images[0].url = source
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
