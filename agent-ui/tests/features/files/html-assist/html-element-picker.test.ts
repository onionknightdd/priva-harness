import assert from "node:assert/strict"
import { test } from "node:test"
import { JSDOM } from "jsdom"
import { elementBox, HtmlElementRegistry, pickHtmlElement } from "../../../../src/features/files/html-assist/html-element-picker.ts"
import { isHtmlElementTarget } from "../../../../src/features/files/html-assist/html-assist-protocol.ts"
import { HTML_TARGET_LIMITS } from "../../../../src/features/files/html-assist/html-assist.types.ts"

function withDocument(html: string, run: (document: Document) => void): void {
  const dom = new JSDOM(html)
  const globals = ["document", "Document", "HTMLElement", "ShadowRoot", "Node", "NodeFilter", "CSS"] as const
  const previous = globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  for (const key of globals) {
    const value = key === "CSS" ? { escape: (input: string) => {
      // Fixtures deliberately use CSS identifiers needing no escaping.
      assert.match(input, /^[A-Za-z0-9_-]+$/)
      return input
    } } : dom.window[key as keyof typeof dom.window]
    Object.defineProperty(globalThis, key, { configurable: true, value })
  }
  Object.defineProperty(dom.window.Element.prototype, "getBoundingClientRect", {
    value() { return { x: 10, y: 20, width: 100, height: 40 } },
  })
  try { run(dom.window.document) } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
    dom.window.close()
  }
}

test("capture keeps hit identity, viewport box, bounded context and truncation flags together", () => withDocument(`<main aria-label="Report"><div><script>secretScript()</script>${"content ".repeat(1500)}</div></main>`, (document) => {
  const element = document.querySelector("div")!
  const registry = new HtmlElementRegistry(document, "doc-example")
  const target = registry.capture(registry.remember(element))
  assert.equal(isHtmlElementTarget(target), true)
  assert.ok(target.text.length <= HTML_TARGET_LIMITS.text && target.text.length > HTML_TARGET_LIMITS.text - 10)
  assert.equal(target.html.length, HTML_TARGET_LIMITS.html)
  assert.equal(target.textTruncated, true)
  assert.equal(target.htmlTruncated, true)
  assert.equal(target.text.includes("secretScript"), false)
  assert.equal(document.querySelector(target.locator.selectors[0]!), element)
  assert.deepEqual(target.boxes, [elementBox(element)])
  assert.equal(target.ancestors[0], "main · Report")
}))

test("captured weak identity survives clearing the batch, but never resolves to an identical replacement", () => withDocument("<main><p>Original selected content</p></main>", (document) => {
  const registry = new HtmlElementRegistry(document, "doc-example")
  const element = document.querySelector("p")!
  const target = registry.capture(registry.remember(element))
  registry.retain(new Set())
  assert.deepEqual(registry.reveal(target.locator), { valid: true, element })
  element.replaceWith(element.cloneNode(true))
  assert.deepEqual(registry.validate(target.locator), { valid: false, reason: "removed" })
  assert.deepEqual(registry.reveal(target.locator), { valid: false, reason: "removed" })
}))

for (const mutation of ["insert-before", "remove-before"] as const) {
  test(`unique nth-selector drift after ${mutation} invalidates the old locator`, () => withDocument("<ul><li>Repeated</li><li>Repeated</li><li>Repeated</li></ul>", (document) => {
    const registry = new HtmlElementRegistry(document, "doc-example")
    const element = document.querySelectorAll("li")[1]!
    const target = registry.capture(registry.remember(element))
    if (mutation === "insert-before") element.before(element.cloneNode(true))
    else element.previousElementSibling!.remove()
    const matches = document.querySelectorAll(target.locator.selectors[0]!)
    assert.equal(matches.length, 1)
    assert.notEqual(matches[0], element)
    assert.equal(element.isConnected, true)
    assert.deepEqual(registry.validate(target.locator), { valid: false, reason: "changed" })
  }))
}

test("content changes invalidate a captured node while an unchanged ID survives sibling insertion", () => withDocument('<main><p id="selected-paragraph">Original</p></main>', (document) => {
  const registry = new HtmlElementRegistry(document, "doc-example")
  const element = document.querySelector("p")!
  const target = registry.capture(registry.remember(element))
  element.before(document.createElement("p"))
  assert.deepEqual(registry.validate(target.locator), { valid: true, element })
  element.textContent = "Changed"
  assert.deepEqual(registry.validate(target.locator), { valid: false, reason: "changed" })
}))

test("open shadow roots create ordered selectors that all resolve to the captured leaf", () => withDocument('<section id="shadow-container"></section>', (document) => {
  const host = document.querySelector("section")!
  const shadow = host.attachShadow({ mode: "open" })
  shadow.innerHTML = '<button><span>Shadow content</span></button>'
  const element = shadow.querySelector("span")!
  const registry = new HtmlElementRegistry(document, "doc-example")
  const target = registry.capture(registry.remember(element))
  assert.equal(target.locator.selectors.length, 2)
  assert.equal(document.querySelector(target.locator.selectors[0]!), host)
  assert.equal(shadow.querySelector(target.locator.selectors[1]!), element)
  assert.deepEqual(registry.validate(target.locator), { valid: true, element })
  Object.defineProperty(document, "elementsFromPoint", { value: () => [host] })
  Object.defineProperty(shadow, "elementsFromPoint", { value: () => [element, host] })
  assert.equal(pickHtmlElement(document, 30, 30), element)
}))

test("cross-document replay requires both selector identity and a globally unique snapshot", () => withDocument('<main><div><span>Same text</span></div><aside><span>Same text</span></aside><p>Unique content</p></main>', (document) => {
  const first = new HtmlElementRegistry(document, "doc-first")
  const repeated = first.capture(first.remember(document.querySelector("span")!))
  const unique = first.capture(first.remember(document.querySelector("p")!))
  const next = new HtmlElementRegistry(document, "doc-next")
  assert.deepEqual(next.reveal(repeated.locator), { valid: false, reason: "ambiguous" })
  assert.deepEqual(next.reveal(unique.locator), { valid: true, element: document.querySelector("p") })
}))

test("transparent decorative overlays are skipped while interactive overlays remain selectable", () => withDocument('<div id="decoration" style="position:fixed;background:transparent;background-image:none;box-shadow:none;border:0"></div><button style="position:fixed;background:transparent;background-image:none;box-shadow:none;border:0"></button><p>Content</p>', (document) => {
  const decoration = document.querySelector("div")!
  const button = document.querySelector("button")!
  const paragraph = document.querySelector("p")!
  for (const element of [decoration, button]) Object.defineProperty(element, "getBoundingClientRect", { value: () => ({ x: 0, y: 0, width: 1024, height: 768 }) })
  let stack = [decoration, paragraph]
  Object.defineProperty(document, "elementsFromPoint", { value: () => stack })
  assert.equal(pickHtmlElement(document, 20, 20), paragraph)
  stack = [button, paragraph]
  assert.equal(pickHtmlElement(document, 20, 20), button)
  decoration.setAttribute("role", "button")
  stack = [decoration, paragraph]
  assert.equal(pickHtmlElement(document, 20, 20), decoration)
}))

test("Alt selects the whole table and SVG leaf selectors retain the actual hit node", () => withDocument('<table><tr><td><span>Cell</span></td></tr></table><svg><g><path d="M0 0 L10 10" /></g></svg>', (document) => {
  let hit = document.querySelector("span")!
  Object.defineProperty(document, "elementsFromPoint", { value: () => [hit] })
  assert.equal(pickHtmlElement(document, 20, 20, true), document.querySelector("table"))
  hit = document.querySelector("path")!
  const registry = new HtmlElementRegistry(document, "doc-example")
  const target = registry.capture(registry.remember(pickHtmlElement(document, 20, 20)!))
  assert.equal(target.locator.tagName, "path")
  assert.equal(document.querySelector(target.locator.selectors[0]!), hit)
}))
