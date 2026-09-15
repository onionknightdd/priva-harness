import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
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

test("sticky freeze restores stuck glass before observer delivery", async () => {
  const passed: string[] = []
  await runStickyFreezeChecks((name, condition) => {
    assert.equal(condition, true, name)
    passed.push(name)
  })
  assert.ok(passed.includes("the stuck user bar uses the glass surface"))
  assert.ok(passed.includes("the stuck user bar uses navbar glass classes"))
  assert.ok(passed.includes("the working bar stays opaque while the user bar is glass"))
})

test("stuck glass uses the Glassmorphism Navbar classes", async () => {
  const source = await readFile(
    new URL("../../../src/features/agent-message/components/sticky-freeze.tsx", import.meta.url),
    "utf8"
  )
  assert.match(source, /supports-backdrop-filter:bg-background\/60/)
  assert.match(source, /supports-backdrop-filter:backdrop-blur-xl/)
  assert.match(source, /supports-backdrop-filter:backdrop-saturate-150/)
})
