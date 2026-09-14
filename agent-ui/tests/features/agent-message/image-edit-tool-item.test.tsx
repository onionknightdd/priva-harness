import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"
import { compile } from "tailwindcss"

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
dom.window.HTMLElement.prototype.setPointerCapture = () => {}
dom.window.HTMLElement.prototype.releasePointerCapture = () => {}
dom.window.HTMLElement.prototype.hasPointerCapture = () => false
// Component behavior is tested in Node; CSS layout is covered by the browser fixture.
const hooks = registerHooks({
  load: (url, context, nextLoad) => {
    if (url.endsWith(".css")) return { format: "module", source: "export default {}", shortCircuit: true }
    const result = nextLoad(url, context)
    if (url.endsWith("/file-type-icon.tsx")) return { ...result, source: `import.meta.env = { DEV: false, BASE_URL: "/" };\n${result.source}` }
    return result
  },
})
const originalFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  assert.equal(input, "/api/sandbox/files/exists")
  const { paths } = JSON.parse(String(init?.body)) as { paths: string[] }
  return Response.json({ exists: Object.fromEntries(paths.map((path) => [path, true])) })
}
after(() => { hooks.deregister(); dom.window.close(); globalThis.fetch = originalFetch })

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { I18nextProvider, initReactI18next } = await import("react-i18next")
const i18n = (await import("i18next")).createInstance()
const { en } = await import("../../../src/i18n/locales/en.ts")
const { zhCN } = await import("../../../src/i18n/locales/zh-CN.ts")
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en }, "zh-CN": { translation: zhCN } } })
const { ImageEditToolItem } = await import("../../../src/features/agent-message/components/image-edit-tool-item.tsx")
const { SidebarProvider } = await import("../../../src/components/ui/sidebar.tsx")
const { WorkspaceFilesProvider, useOptionalWorkspaceFiles } = await import("../../../src/features/workspace/workspace-files-context.tsx")

function OpenedFile() {
  return <output>{useOptionalWorkspaceFiles()?.pendingFilePath}</output>
}

const completed: ImageToolBlock = {
  type: "tool_use", id: "edit", blockId: "edit", index: 0, name: "mcp__agentWorkshop__image_edit",
  input: { prompt: "Turn daylight into moonlight.", image_path: "source.png, references/portrait.png" },
  tool: { id: "edit", name: "mcp__agentWorkshop__image_edit", status: "completed", ok: true, output: "/workspace/.images/result.png" },
}

async function mount(block = completed) {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const update = async (next: ImageToolBlock) => {
    await act(async () => root.render(
      <I18nextProvider i18n={i18n}>
        <SidebarProvider className="block min-h-0" stateCookieName={false} widthCookieName={false}>
          <WorkspaceFilesProvider>
            <ImageEditToolItem block={next} cwd="/workspace" />
            <OpenedFile />
          </WorkspaceFilesProvider>
        </SidebarProvider>
      </I18nextProvider>
    ))
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
async function key(element: HTMLElement, key: string, shiftKey = false) {
  await act(async () => element.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })))
}

const comparisonLabels = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('[data-slot="image-comparison-file-label"]')]
function assertMajorityLabel(host: HTMLElement, side: "before" | "after" | null) {
  const labels = comparisonLabels(host)
  assert.equal(labels.length, 2)
  assert.deepEqual(labels.filter(label => label.getAttribute("aria-hidden") === "false").map(label => label.dataset.side), side ? [side] : [])
  for (const label of labels) {
    const visible = label.dataset.side === side
    assert.equal(label.style.opacity, visible ? "1" : "0")
    assert.equal(label.hasAttribute("inert"), !visible)
  }
}

test("Edit shows filename links above the images and opens the correct source and result in Workspace", async () => {
  const view = await mount()
  try {
    assert.ok(view.host.querySelector(".lucide-images"))
    assert.ok(view.host.textContent!.indexOf("Turn daylight") < view.host.textContent!.indexOf(i18n.t("agentMessage.imageTools.sideBySide")))
    assert.equal(button(view.host, i18n.t("agentMessage.imageTools.sideBySide")).getAttribute("aria-pressed"), "true")
    assert.deepEqual(paths(view.host), ["/workspace/source.png", "/workspace/.images/result.png"])
    const labels = view.host.querySelector('[data-slot="image-edit-file-labels"]')!
    assert.ok(labels.compareDocumentPosition(view.host.querySelector("img")!) & Node.DOCUMENT_POSITION_FOLLOWING)
    assert.ok(!labels.textContent!.includes("/workspace/"))
    assert.equal(view.host.querySelector("dl"), null)
    await click(button(view.host, "source.png"))
    assert.equal(view.host.querySelector("output")!.textContent, "/workspace/source.png")
    await click(button(view.host, "result.png"))
    assert.equal(view.host.querySelector("output")!.textContent, "/workspace/.images/result.png")
    await click(button(view.host, "Original 2"))
    assert.deepEqual(paths(view.host), ["/workspace/references/portrait.png", "/workspace/.images/result.png"])
    await click(button(view.host, "portrait.png"))
    assert.equal(view.host.querySelector("output")!.textContent, "/workspace/references/portrait.png")
    await imagesLoad(view.host)
    await click(view.host.querySelector<HTMLButtonElement>('button[aria-busy="false"]')!)
    assert.equal(new URL(document.querySelector<HTMLImageElement>('[role="dialog"] img')!.src).searchParams.get("path"), "/workspace/references/portrait.png")
  } finally { await view.close() }
})

test("Slide keeps both full images, supports keyboard endpoints, and preserves source selection between modes", async () => {
  const view = await mount()
  try {
    await click(button(view.host, "Original 2"))
    await click(button(view.host, i18n.t("agentMessage.imageTools.compare")))
    await imagesLoad(view.host)
    const range = view.host.querySelector<HTMLInputElement>('input[type="range"]')!
    assert.equal(range.disabled, false)
    assert.equal(range.value, "50")
    assert.equal(range.getAttribute("aria-label"), "Original and result divider")
    assertMajorityLabel(view.host, null)
    assert.deepEqual(paths(view.host), ["/workspace/.images/result.png", "/workspace/references/portrait.png"])
    const reveal = view.host.querySelector<HTMLElement>('[data-slot="image-comparison-before"]')!
    assert.match(reveal.style.clipPath, /50%/)
    await key(range, "ArrowRight")
    assert.equal(range.value, "50.1")
    assert.match(reveal.style.clipPath, /49.9%/)
    assertMajorityLabel(view.host, "before")
    await click(button(view.host, "portrait.png"))
    assert.equal(view.host.querySelector("output")!.textContent, "/workspace/references/portrait.png")
    assert.equal(range.value, "50.1")
    assert.ok(comparisonLabels(view.host).every(label => label.style.transitionDuration === "0ms"))
    await key(range, "ArrowRight", true)
    assert.equal(range.value, "60.1")
    await key(range, "End")
    assert.equal(range.value, "100")
    assertMajorityLabel(view.host, "before")
    await key(range, "Home")
    assert.equal(range.value, "0")
    assert.match(reveal.style.clipPath, /100%/)
    assertMajorityLabel(view.host, "after")
    assert.ok(comparisonLabels(view.host).find(label => label.dataset.side === "after")!.textContent!.startsWith("Edited"))
    await click(button(view.host, "result.png"))
    assert.equal(view.host.querySelector("output")!.textContent, "/workspace/.images/result.png")
    assert.equal(range.value, "0")
    await click(button(view.host, i18n.t("agentMessage.imageTools.sideBySide")))
    assert.deepEqual(paths(view.host), ["/workspace/references/portrait.png", "/workspace/.images/result.png"])
  } finally { await view.close() }
})

test("comparison labels follow fractional pointer positions, switch at half, and fade only opacity", async () => {
  const view = await mount()
  const style = document.head.appendChild(document.createElement("style"))
  try {
    await click(button(view.host, i18n.t("agentMessage.imageTools.compare")))
    await imagesLoad(view.host)
    const range = view.host.querySelector<HTMLInputElement>('input[type="range"]')!
    const control = view.host.querySelector('[data-slot="image-comparison-before"]')!.parentElement!
    control.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 256)
    const compiler = await compile("@tailwind utilities;")
    style.textContent = compiler.build([...new Set(comparisonLabels(view.host).flatMap(label => [...label.classList]))])
    for (const label of comparisonLabels(view.host)) {
      assert.equal(getComputedStyle(label).transitionProperty, "opacity")
      assert.equal(getComputedStyle(label).transitionDuration, "160ms")
    }
    const pointer = async (type: string, position: number) => {
      await act(async () => (type === "pointerdown" ? control : document).dispatchEvent(new PointerEvent(type, {
        clientX: position * 10, clientY: 100, pointerId: 1, pointerType: "mouse", isPrimary: true,
        button: 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true,
      })))
    }
    await pointer("pointerdown", 50)
    try {
      for (const position of [50.1, 70, 49.9, 30, 50, 100, 0, 75, 25]) {
        await pointer("pointermove", position)
        assert.equal(Number(range.value), position)
        assertMajorityLabel(view.host, position > 50 ? "before" : position < 50 ? "after" : null)
        for (const label of comparisonLabels(view.host)) {
          const translation = Number(/translateX\(([-\d.]+)%\)/.exec(label.style.transform)![1])
          // Each track is half a canvas wide, with its handle-facing edge at
          // the midpoint before translation. Compare that edge to the thumb.
          assert.ok(Math.abs(50 + translation / 2 - Number(range.value)) < 0.001)
          assert.equal(label.style.transitionDuration, "")
        }
      }
    } finally { await pointer("pointerup", 25) }
    await click(button(view.host, "result.png"))
    assert.equal(view.host.querySelector("output")!.textContent, "/workspace/.images/result.png")
    assert.equal(range.value, "25")
    await click(button(view.host, "Original 2"))
    assert.equal(view.host.querySelector<HTMLInputElement>('input[type="range"]')!.value, "50")
    assertMajorityLabel(view.host, null)
  } finally { style.remove(); await view.close() }
})

test("running Edit transitions to an open result and preserves source images on errors", async () => {
  const view = await mount({ ...completed, tool: { ...completed.tool!, status: "running", output: "" } })
  try {
    assert.equal(button(view.host, i18n.t("agentMessage.imageTools.compare")).disabled, true)
    assert.equal(view.host.querySelectorAll("img").length, 1)
    assert.ok(view.host.querySelector('[data-slot="skeleton"]'))
    await view.update(completed)
    assert.equal(view.host.querySelector('button[aria-expanded]')!.getAttribute("aria-expanded"), "true")
    assert.equal(button(view.host, i18n.t("agentMessage.imageTools.compare")).disabled, false)
    const error = '{"error":{"message":"Original upstream error <detail>"}}'
    await view.update({ ...completed, tool: { ...completed.tool!, ok: false, output: error } })
    assert.equal(view.host.querySelector('[role="alert"]')!.textContent, error)
    assert.equal(button(view.host, i18n.t("agentMessage.imageTools.compare")).disabled, true)
    assert.deepEqual(paths(view.host), ["/workspace/source.png"])
    await view.update({ ...completed, tool: { ...completed.tool!, output: error } })
    assert.equal(view.host.querySelector('[role="alert"]')!.textContent, error)
  } finally { await view.close() }
})

test("a failed Slide image can be reloaded without regenerating the result", async () => {
  const view = await mount()
  try {
    await click(button(view.host, i18n.t("agentMessage.imageTools.compare")))
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
    assert.ok(button(view.host, "并排"))
    assert.ok(button(view.host, "对比"))
    assert.equal(button(view.host, i18n.t("agentMessage.imageTools.compare")).disabled, true)
    assert.deepEqual(paths(view.host), ["/workspace/.images/result.png"])
    await view.update(completed)
    await click(button(view.host, i18n.t("agentMessage.imageTools.compare")))
    await imagesLoad(view.host)
    const range = view.host.querySelector<HTMLInputElement>('input[type="range"]')!
    assert.equal(range.getAttribute("aria-label"), "原图与结果分隔线")
    await key(range, "End")
    assert.equal(comparisonLabels(view.host).find(label => label.dataset.side === "before")!.textContent, "原图source.png")
    await key(range, "Home")
    assert.equal(comparisonLabels(view.host).find(label => label.dataset.side === "after")!.textContent, "修改后result.png")
  } finally { await view.close(); await i18n.changeLanguage("en") }
})
