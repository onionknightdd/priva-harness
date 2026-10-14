import assert from "node:assert/strict"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

const dom = new JSDOM(`<!doctype html><html><body>
<div id="surface">
  <div class="line"><span class="num" style="user-select: none">11</span><code>hello</code></div>
  <div class="line"><span class="num" style="user-select: none">12</span><code>next</code></div>
</div>
<pre id="raw">alpha
beta
gamma</pre>
</body></html>`, { url: "http://localhost", pretendToBeVisual: true })

for (const key of ["window", "document", "Node", "Text", "getComputedStyle", "DOMRect", "Range"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
after(() => dom.window.close())

const { sourceSelectionAnchor } = await import("../../../../src/features/files/selection/source-selection-anchor.ts")

function caretFor(range: Range) {
  if (!range.collapsed || range.endContainer.nodeType !== Node.TEXT_NODE) return new DOMRect(0, 0, 0, 0)
  const value = range.endContainer.nodeValue ?? ""
  if (value === "11" || value === "12") return new DOMRect(8, 72, 0, 16)
  if (value === "hello" && range.endOffset === 2) return new DOMRect(0, 0, 0, 0)
  if (value === "hello" && range.endOffset === 0) return new DOMRect(40, 48, 0, 16)
  if (value === "hello" && range.endOffset === value.length) return new DOMRect(180, 48, 0, 16)
  const previous = value.charAt(range.endOffset - 1)
  if (previous && previous !== "\n" && previous !== "\r") return new DOMRect(180, 48, 0, 16)
  return new DOMRect(16, 72, 0, 16)
}

dom.window.Range.prototype.getBoundingClientRect = function () {
  return caretFor(this)
}
dom.window.Range.prototype.getClientRects = function () {
  const content = new DOMRect(40, 48, 140, 16)
  const gutter = new DOMRect(8, 72, 24, 16)
  const list = [content, gutter]
  return Object.assign(list, { item: (index: number) => list[index] ?? null })
}

test("a trailing newline anchors at the end of the current line, past the line-number gutter", () => {
  const hello = document.querySelector("#surface code")!.firstChild!
  const nextCode = document.querySelectorAll("#surface code")[1]!
  const range = document.createRange()
  range.setStart(hello, 0)
  range.setEnd(nextCode, 0)

  assert.deepEqual(sourceSelectionAnchor("hello\n", false, range), { left: 180, top: 48, bottom: 64, width: 0 })
})

test("a trailing newline inside one text node anchors before that break", () => {
  const text = document.querySelector("#raw")!.firstChild!
  const range = document.createRange()
  range.setStart(text, 0)
  range.setEnd(text, "alpha\nbeta\n".length)

  assert.deepEqual(sourceSelectionAnchor("alpha\nbeta\n", false, range), { left: 180, top: 48, bottom: 64, width: 0 })
})

test("a backwards selection keeps the focus at the start of the line", () => {
  const hello = document.querySelector("#surface code")!.firstChild!
  const nextCode = document.querySelectorAll("#surface code")[1]!
  const range = document.createRange()
  range.setStart(hello, 0)
  range.setEnd(nextCode, 0)

  assert.deepEqual(sourceSelectionAnchor("hello\n", true, range), { left: 40, top: 48, bottom: 64, width: 0 })
})

test("a selection that continues past the newline keeps the caret at its endpoint", () => {
  const text = document.querySelector("#raw")!.firstChild!
  const range = document.createRange()
  range.setStart(text, 0)
  range.setEnd(text, "alpha\nbe".length)

  assert.equal(sourceSelectionAnchor("alpha\nbe", false, range)?.left, 180)
})

test("a caret without geometry falls back to the last selection rect", () => {
  const hello = document.querySelector("#surface code")!.firstChild!
  const range = document.createRange()
  range.setStart(hello, 0)
  range.setEnd(hello, 2)

  assert.deepEqual(sourceSelectionAnchor("he", false, range), { left: 32, top: 72, bottom: 88, width: 0 })
})
