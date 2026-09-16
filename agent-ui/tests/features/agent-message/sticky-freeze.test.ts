import assert from "node:assert/strict"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "Element", "Node", "DocumentFragment", "Event", "DOMRect", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
})
dom.window.matchMedia = (query) => ({
  matches: query.includes("prefers-reduced-motion"),
  media: query,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => true,
  onchange: null,
})
after(() => { dom.window.close() })

const { runStickyFreezeChecks } = await import("./sticky-freeze-checks.tsx")

test("shared glass follows restored and live sticky geometry", async () => {
  const passed: string[] = []
  await runStickyFreezeChecks((name, condition) => {
    assert.equal(condition, true, name)
    passed.push(name)
  })
  assert.ok(passed.includes("one continuous surface covers header and restored user"))
  assert.ok(passed.includes("the shared glass extends to the lower streaming bar"))
})
