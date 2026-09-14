import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

import type { ImageToolBlock } from "../../../src/features/agent-message/image-tool-data.ts"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "ShadowRoot", "SVGElement", "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "DOMRect", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})
dom.window.matchMedia = (query) => ({ matches: true, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, onchange: null })
dom.window.HTMLElement.prototype.getAnimations = () => []
dom.window.HTMLElement.prototype.scrollIntoView = () => {}
// Component behavior is tested in Node; CSS layout is covered by the browser fixture.
const hooks = registerHooks({
  load: (url, context, nextLoad) => url.endsWith(".css")
    ? { format: "module", source: "export default {}", shortCircuit: true }
    : nextLoad(url, context),
})
after(() => { hooks.deregister(); dom.window.close() })

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { I18nextProvider, initReactI18next } = await import("react-i18next")
const i18n = (await import("i18next")).createInstance()
const { en } = await import("../../../src/i18n/locales/en.ts")
const { zhCN } = await import("../../../src/i18n/locales/zh-CN.ts")
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en }, "zh-CN": { translation: zhCN } } })
const { ImageEditToolItem } = await import("../../../src/features/agent-message/components/image-edit-tool-item.tsx")

const completed: ImageToolBlock = {
  type: "tool_use", id: "edit", blockId: "edit", index: 0, name: "mcp__agentWorkshop__image_edit",
  input: { prompt: "Turn daylight into moonlight.", image_path: "source.png, references/portrait.png" },
  tool: { id: "edit", name: "mcp__agentWorkshop__image_edit", status: "completed", ok: true, output: "/workspace/.images/result.png" },
}

async function mount(block = completed) {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const update = async (next: ImageToolBlock) => {
    await act(async () => root.render(<I18nextProvider i18n={i18n}><ImageEditToolItem block={next} cwd="/workspace" /></I18nextProvider>))
  }
  await update(block)
  const toggle = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!
  if (toggle.getAttribute("aria-expanded") === "false") await click(toggle)
  return { host, update, async close() { await act(async () => root.unmount()); host.remove() } }
}

async function click(element: HTMLElement) {
  assert.ok(element)
  await act(async () => element.click())
}
const button = (host: HTMLElement, label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent === label)!
const paths = (host: HTMLElement) => [...host.querySelectorAll<HTMLImageElement>("img")].map((image) => new URL(image.src).searchParams.get("path"))
async function imagesLoad(host: HTMLElement) {
  await act(async () => {
    for (const image of host.querySelectorAll("img")) {
      Object.defineProperties(image, { naturalWidth: { configurable: true, value: 1200 }, naturalHeight: { configurable: true, value: 800 } })
      image.dispatchEvent(new Event("load"))
    }
  })
}
async function key(element: HTMLElement, key: string) {
  await act(async () => element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })))
}

test("Edit renders prompt, selectable source previews, result, and full paths for MCP calls", async () => {
  const view = await mount()
  try {
    assert.ok(view.host.querySelector(".lucide-images"))
    assert.ok(view.host.textContent!.indexOf("Turn daylight") < view.host.textContent!.indexOf("Side-by-side"))
    assert.equal(button(view.host, "Side-by-side").getAttribute("aria-pressed"), "true")
    assert.deepEqual(paths(view.host), ["/workspace/source.png", "/workspace/.images/result.png"])
    await click(button(view.host, "Original 2"))
    assert.deepEqual(paths(view.host), ["/workspace/references/portrait.png", "/workspace/.images/result.png"])
    assert.ok(view.host.querySelector("dl")!.textContent!.includes("/workspace/references/portrait.png"))
    await imagesLoad(view.host)
    await click(view.host.querySelector<HTMLButtonElement>('button[aria-busy="false"]')!)
    assert.equal(new URL(document.querySelector<HTMLImageElement>('[role="dialog"] img')!.src).searchParams.get("path"), "/workspace/references/portrait.png")
  } finally { await view.close() }
})

test("Slide keeps both full images, supports keyboard endpoints, and preserves source selection between modes", async () => {
  const view = await mount()
  try {
    await click(button(view.host, "Original 2"))
    await click(button(view.host, "Slide"))
    await imagesLoad(view.host)
    const range = view.host.querySelector<HTMLInputElement>('input[type="range"]')!
    assert.equal(range.disabled, false)
    assert.equal(range.value, "50")
    assert.equal(range.getAttribute("aria-label"), "Original and result divider")
    assert.deepEqual(paths(view.host), ["/workspace/.images/result.png", "/workspace/references/portrait.png"])
    const reveal = view.host.querySelector<HTMLElement>('[data-slot="image-comparison-before"]')!
    assert.match(reveal.style.clipPath, /50%/)
    await key(range, "ArrowRight")
    assert.equal(range.value, "51")
    assert.match(reveal.style.clipPath, /49%/)
    await key(range, "End")
    assert.equal(range.value, "100")
    await key(range, "Home")
    assert.equal(range.value, "0")
    assert.match(reveal.style.clipPath, /100%/)
    await click(button(view.host, "Side-by-side"))
    assert.deepEqual(paths(view.host), ["/workspace/references/portrait.png", "/workspace/.images/result.png"])
  } finally { await view.close() }
})

test("running Edit transitions to an open result and preserves source images on errors", async () => {
  const view = await mount({ ...completed, tool: { ...completed.tool!, status: "running", output: "" } })
  try {
    assert.equal(button(view.host, "Slide").disabled, true)
    assert.equal(view.host.querySelectorAll("img").length, 1)
    assert.ok(view.host.querySelector('[data-slot="skeleton"]'))
    await view.update(completed)
    assert.equal(view.host.querySelector('button[aria-expanded]')!.getAttribute("aria-expanded"), "true")
    assert.equal(button(view.host, "Slide").disabled, false)
    const error = '{"error":{"message":"Original upstream error <detail>"}}'
    await view.update({ ...completed, tool: { ...completed.tool!, ok: false, output: error } })
    assert.equal(view.host.querySelector('[role="alert"]')!.textContent, error)
    assert.equal(button(view.host, "Slide").disabled, true)
    assert.deepEqual(paths(view.host), ["/workspace/source.png"])
    await view.update({ ...completed, tool: { ...completed.tool!, output: error } })
    assert.equal(view.host.querySelector('[role="alert"]')!.textContent, error)
  } finally { await view.close() }
})

test("a failed Slide image can be reloaded without regenerating the result", async () => {
  const view = await mount()
  try {
    await click(button(view.host, "Slide"))
    await act(async () => view.host.querySelector("img")!.dispatchEvent(new Event("error")))
    assert.ok(view.host.querySelector('[role="alert"]')!.textContent!.includes("could not be loaded"))
    await click(button(view.host, "Reload image"))
    assert.equal(new URL(view.host.querySelector("img")!.src).searchParams.get("retry"), "1")
    await imagesLoad(view.host)
    assert.equal(view.host.querySelector<HTMLInputElement>('input[type="range"]')!.disabled, false)
  } finally { await view.close() }
})

test("missing inputs stay usable and the comparison is localized", async () => {
  await act(async () => i18n.changeLanguage("zh-CN"))
  const view = await mount({ ...completed, input: { prompt: "保留构图。" } })
  try {
    assert.ok(view.host.textContent!.includes("未记录原图路径。"))
    assert.equal(button(view.host, "Slide").disabled, true)
    assert.deepEqual(paths(view.host), ["/workspace/.images/result.png"])
    await view.update(completed)
    await click(button(view.host, "Slide"))
    await imagesLoad(view.host)
    assert.equal(view.host.querySelector<HTMLInputElement>('input[type="range"]')!.getAttribute("aria-label"), "原图与结果分隔线")
  } finally { await view.close(); await i18n.changeLanguage("en") }
})
