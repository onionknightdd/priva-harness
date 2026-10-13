import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

import type { StreamBlock } from "../../../src/features/agent-message/agent-message-data.ts"

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
after(() => { hooks.deregister(); dom.window.close() })
const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { I18nextProvider, initReactI18next } = await import("react-i18next")
const i18n = (await import("i18next")).createInstance()
const { en } = await import("../../../src/i18n/locales/en.ts")
const { zhCN } = await import("../../../src/i18n/locales/zh-CN.ts")
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en }, "zh-CN": { translation: zhCN } } })
const { CodemodeToolItem } = await import("../../../src/features/agent-message/components/codemode-tool-item.tsx")

test("shows native model results, deduplicates image previews and keeps code disclosure accessible", async () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const block: Extract<StreamBlock, { type: "tool_use" }> = {
    type: "tool_use", blockId: "code", id: "code", name: "codemode", index: 0,
    input: { code: 'text(await models.classify({prompt:"x"}));' },
    tool: { id: "code", name: "codemode", status: "completed", ok: true, nestedCallsComplete: false,
      artifacts: [{ path: "/workspace/.images/native.png", mimeType: "image/png" }],
      modelCalls: [
        { id: "image", parentToolCallId: "code", operation: "generateImages", provider: "images", model: "native", status: "completed", durationMs: 2500, artifacts: [{ path: "/workspace/.images/native.png", mimeType: "image/png" }] },
        { id: "classifier", parentToolCallId: "code", operation: "classify", provider: "classifier", model: "judge", status: "completed", result: { label: "accepted", confidence: 0.95 } },
        { id: "cancelled", parentToolCallId: "code", operation: "classify", provider: "classifier", model: "stopped", status: "aborted", error: "Cancelled by user" },
      ] },
  }
  try {
    await act(async () => root.render(<I18nextProvider i18n={i18n}><CodemodeToolItem block={block}><p>MCP child call</p></CodemodeToolItem></I18nextProvider>))
    assert.match(host.textContent ?? "", /MCP child call/)
    assert.match(host.textContent ?? "", /accepted/)
    assert.match(host.textContent ?? "", /0.95/)
    assert.match(host.textContent ?? "", /2.5s/)
    assert.match(host.textContent ?? "", /bounded summary/)
    assert.equal(host.querySelectorAll('img').length, 1)
    assert.equal(host.querySelectorAll('[data-state="cancelled"]').length, 1)
    const codeButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('JavaScript'))
    assert.ok(codeButton)
    assert.equal(codeButton.getAttribute('aria-expanded'), 'false')
    await act(async () => codeButton.click())
    assert.equal(codeButton.getAttribute('aria-expanded'), 'true')
    assert.match(host.textContent ?? "", /models.classify/)
    await act(async () => i18n.changeLanguage('zh-CN'))
    assert.match(host.textContent ?? "", /图片模型/)
    assert.match(host.textContent ?? "", /分类模型/)
  } finally { await act(async () => root.unmount()); host.remove() }
})
