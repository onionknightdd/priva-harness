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
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
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
const { MotionConfig } = await import("motion/react")
const { LiveTextScope, StableText } = await import("../../../src/components/motion/stable-text.tsx")
type Piece = { id: string; text: string; count?: boolean; steady?: boolean }

function sentence(pieces: Piece[], reduce = false) {
  return React.createElement(MotionConfig, { reducedMotion: reduce ? "always" : "never" },
    React.createElement(LiveTextScope, null, React.createElement(StableText, { pieces })))
}

function visualPieces(host: HTMLElement) {
  return [...host.querySelectorAll(":scope > span > span[aria-hidden='true']")]
}

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

test("a replacement keeps the outgoing phrase visible and exposes only the new sentence", async () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const clock = { id: "clock", text: "已运行 4s", steady: true }
  await act(async () => { root.render(sentence([clock, { id: "read:running", text: "，正在读取2个文件" }])) })
  const [clockNode, oldPhrase] = visualPieces(host)
  assert.ok(oldPhrase)
  await act(async () => { root.render(sentence([clock, { id: "read:done", text: "，已读取2个文件" }])) })
  assert.equal(oldPhrase.isConnected, true)
  assert.ok(Number(getComputedStyle(oldPhrase).opacity) > 0)
  assert.equal(visualPieces(host)[0], clockNode)
  assert.equal(host.firstElementChild?.firstElementChild?.textContent, "已运行 4s，已读取2个文件")
  assert.equal(oldPhrase.getAttribute("aria-hidden"), "true")
  await act(async () => { root.unmount() })
  host.remove()
})

test("literal edits retain their old glyph layer, including a quick reversal", async () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  await act(async () => { root.render(sentence([{ id: "unit", text: " file" }])) })
  const original = host.querySelector(".absolute")!
  assert.ok(original)
  await act(async () => { root.render(sentence([{ id: "unit", text: " files" }])) })
  assert.equal(original.isConnected, true)
  assert.deepEqual([...host.querySelectorAll(".absolute")].map((node) => node.textContent).sort(), [" file", " files"])
  await act(async () => { root.render(sentence([{ id: "unit", text: " file" }])) })
  assert.equal(original.isConnected, true)
  assert.equal(host.firstElementChild?.firstElementChild?.textContent, " file")
  await act(async () => { root.unmount() })
  host.remove()
})

test("reduced motion swaps to visible current text without retaining outgoing phrases", async () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  await act(async () => { root.render(sentence([{ id: "running", text: "Reading" }], true)) })
  const oldPhrase = visualPieces(host)[0]
  await act(async () => { root.render(sentence([{ id: "done", text: "Read" }], true)) })
  assert.equal(oldPhrase.isConnected, false)
  assert.equal(visualPieces(host).length, 1)
  const visible = host.querySelector<HTMLElement>(".absolute")!
  assert.equal(visible.textContent, "Read")
  assert.notEqual(visible.style.opacity, "0")
  assert.equal(visible.style.transform, "")
  await act(async () => { root.render(sentence([{ id: "done", text: "Read 2" }], true)) })
  assert.equal(host.querySelectorAll(".absolute").length, 1)
  assert.equal(visible.isConnected, true)
  assert.equal(visible.textContent, "Read 2")
  await act(async () => { root.unmount() })
  host.remove()
})
