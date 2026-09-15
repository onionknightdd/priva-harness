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
  assert.ok(passed.includes("the stuck user bar paints a frost layer"))
  assert.ok(passed.includes("the working bar stays opaque while the user bar is glass"))
})

test("stuck glass is a milky frosted plate, not a bare blur", async () => {
  const css = await readFile(new URL("../../../src/index.css", import.meta.url), "utf8")
  const start = css.indexOf('[data-slot="sticky-freeze"][data-surface="glass"]')
  const end = css.indexOf("@keyframes loading-state-pixel", start)
  assert.ok(start >= 0 && end > start)
  const section = css.slice(start, end)
  assert.match(section, /sticky-freeze-frost/)
  assert.match(section, /color-mix\(in oklab, var\(--background\)/)
  assert.match(section, /backdrop-filter:\s*blur\(24px\) saturate\(180%\)/)
})
