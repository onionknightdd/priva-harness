import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

import type { CompactMarker } from "../../../src/features/agent-message/slash-command-envelope.ts"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "ShadowRoot", "SVGElement", "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "DOMRect", "MutationObserver", "getComputedStyle"]) {
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
const hooks = registerHooks({
  load: (url, context, nextLoad) => {
    if (url.endsWith(".css")) return { format: "module", source: "export default {}", shortCircuit: true }
    return nextLoad(url, context)
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
const { CompactSessionMarker } = await import("../../../src/features/agent-message/components/compact-session-marker.tsx")

test("only active compaction spins, while queued and terminal states keep the separator", async () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const states: Array<{ marker: CompactMarker; en: string; zh: string }> = [
    { marker: { phase: "queued" }, en: "Compaction queued", zh: "等待压缩" },
    { marker: { phase: "compacting" }, en: "Compacting conversation", zh: "会话压缩中" },
    { marker: { phase: "compacted" }, en: "Conversation compacted", zh: "会话已压缩" },
    { marker: { phase: "failed", message: "Summarizer unavailable" }, en: "Compaction failed", zh: "会话压缩失败" },
    { marker: { phase: "cancelled", message: "Interrupted" }, en: "Compaction stopped", zh: "会话压缩已停止" },
  ]
  try {
    for (const language of ["en", "zh-CN"] as const) {
      await act(async () => { await i18n.changeLanguage(language) })
      for (const state of states) {
        await act(async () => root.render(<I18nextProvider i18n={i18n}><CompactSessionMarker compact={state.marker} /></I18nextProvider>))
        assert.equal(host.textContent, language === "en" ? state.en : state.zh)
        assert.ok(host.querySelector('[data-slot="marker"][data-variant="separator"]'))
        assert.equal(host.querySelectorAll('[data-slot="marker-icon"]').length, state.marker.phase === "compacting" ? 1 : 0)
        assert.equal(host.querySelectorAll('.shimmer').length, state.marker.phase === "compacting" ? 1 : 0)
        if (state.marker.message) assert.ok(host.querySelector('[data-slot="marker-content"][tabindex="0"]'))
      }
    }
    await act(async () => root.render(<I18nextProvider i18n={i18n}><CompactSessionMarker compact={{ phase: "compacted", summary: "Saved context" }} /></I18nextProvider>))
    assert.equal(host.querySelector('button')?.getAttribute('aria-expanded'), 'false')
    await act(async () => host.querySelector('button')?.click())
    assert.match(host.textContent ?? "", /Saved context/)
    assert.equal(host.querySelectorAll('[data-slot="marker-icon"]').length, 0)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
