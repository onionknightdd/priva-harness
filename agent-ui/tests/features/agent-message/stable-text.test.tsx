import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "DocumentFragment"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
})
dom.window.matchMedia = (query) => ({ matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, onchange: null })
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
const { LiveTextScope, StableText } = await import("../../../src/components/motion/stable-text.tsx")

function phrase(count: number, extra = false) {
  return React.createElement(LiveTextScope, null, React.createElement(StableText, {
    pieces: [
      { id: "before", text: "正在读取" },
      { id: "count", text: String(count), count: true },
      { id: "after", text: "个文件" },
      ...(extra ? [{ id: "more", text: "，正在编辑" }] : []),
    ],
  }))
}

function literal(host: HTMLElement, text: string) {
  return [...host.querySelectorAll("span")].find((node) => node.childNodes.length === 1 && node.textContent === text)
}

test("a count change leaves the surrounding words mounted", async () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  await act(async () => { root.render(phrase(1)) })
  await act(async () => { await Promise.resolve() })
  const before = literal(host, "正在读取")
  const after = literal(host, "个文件")
  assert.ok(before)
  assert.ok(after)
  await act(async () => { root.render(phrase(2)) })
  assert.equal(before?.isConnected, true)
  assert.equal(after?.isConnected, true)
  assert.match(host.textContent ?? "", /2/)
  await act(async () => { root.render(phrase(2, true)) })
  assert.equal(before?.isConnected, true)
  assert.match(host.textContent ?? "", /正在编辑/)
  await act(async () => { root.unmount() })
  host.remove()
})
