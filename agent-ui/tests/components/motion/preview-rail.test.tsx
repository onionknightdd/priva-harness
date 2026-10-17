import assert from "node:assert/strict"
import { after, test, type TestContext } from "node:test"
import { JSDOM } from "jsdom"
import type { PreviewRailProps } from "../../../src/components/motion/preview-rail"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
})
dom.window.matchMedia = (query) => ({ matches: true, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, onchange: null })
dom.window.HTMLElement.prototype.getAnimations = () => []
after(() => dom.window.close())

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { PreviewRail } = await import("../../../src/components/motion/preview-rail")

async function fixture(t: TestContext, props: Partial<PreviewRailProps> = {}) {
  const host = document.body.appendChild(document.createElement("div"))
  const outside = document.body.appendChild(document.createElement("button"))
  const selected: string[] = []
  const root = createRoot(host)
  await act(async () => {
    root.render(React.createElement(PreviewRail, {
      items: [{ id: "a", label: "Alpha" }, { id: "b", label: "Bravo" }],
      onItemSelect: (item) => selected.push(item.id),
      ...props,
    }))
  })
  t.after(async () => {
    await act(async () => root.unmount())
    host.remove()
    outside.remove()
  })
  return {
    host,
    outside,
    selected,
    items: [...host.querySelectorAll<HTMLElement>("[data-slot=preview-rail-item]")],
    title: () => host.querySelector("[data-slot=preview-rail-title]")?.textContent ?? null,
    card: () => host.querySelector("[data-slot=preview-rail-position]"),
  }
}

function pointer(target: Element, type: string, options: { pointerType?: string; buttons?: number; relatedTarget?: EventTarget | null } = {}) {
  const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, ...options })
  Object.defineProperties(event, {
    pointerType: { value: options.pointerType ?? "mouse" },
    pointerId: { value: 1 },
  })
  target.dispatchEvent(event)
}

function click(target: Element, detail = 1) {
  const event = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, detail })
  // Observe React's decision before preventing jsdom from following a link.
  let prevented = false
  const stopNavigation = () => { prevented = event.defaultPrevented; event.preventDefault() }
  document.addEventListener("click", stopNavigation, { once: true })
  target.dispatchEvent(event)
  return prevented
}

function key(target: EventTarget, value: string) {
  target.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: value, bubbles: true }))
}

async function interact(action: () => void, dismiss = false) {
  await act(async () => { action() })
  if (dismiss) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)) })
}

test("keyboard focus replaces the hovered item without remounting the card", async (t) => {
  const rail = await fixture(t)
  const [a, b] = rail.items
  await interact(() => pointer(a!, "pointerover"))
  const card = rail.card()
  assert.equal(rail.title(), "Alpha")
  await interact(() => { key(a!, "Tab"); b!.focus() })
  assert.equal(document.activeElement, b)
  assert.equal(rail.title(), "Bravo")
  assert.equal(rail.card(), card)
  await interact(() => pointer(a!, "pointerout", { relatedTarget: rail.outside }))
  assert.equal(rail.title(), "Bravo", "leaving the old hover must not dismiss keyboard focus")
})

test("Escape dismisses hover, focus and tap without restoring an older source", async (t) => {
  const rail = await fixture(t)
  const [a, b] = rail.items
  await interact(() => pointer(a!, "pointerover"))
  await interact(() => key(window, "Escape"), true)
  assert.equal(rail.title(), null)
  await interact(() => { key(window, "Tab"); b!.focus() })
  assert.equal(rail.title(), "Bravo")
  await interact(() => key(b!, "Escape"), true)
  assert.equal(rail.title(), null)
  assert.equal(document.activeElement, b)
  await interact(() => {
    pointer(a!, "pointerdown", { pointerType: "touch", buttons: 1 })
    click(a!)
  })
  assert.equal(rail.title(), "Alpha")
  await interact(() => key(window, "Escape"), true)
  assert.equal(rail.title(), null)
})

test("a mouse press takes ownership back from keyboard focus without reviving it on leave", async (t) => {
  const rail = await fixture(t)
  const [a, b] = rail.items
  await interact(() => pointer(a!, "pointerover"))
  await interact(() => { key(window, "Tab"); b!.focus() })
  assert.equal(rail.title(), "Bravo")
  await interact(() => {
    pointer(a!, "pointerdown", { buttons: 1 })
    a!.focus()
    click(a!)
  })
  assert.equal(rail.title(), "Alpha")
  assert.deepEqual(rail.selected, ["a"])
  await interact(() => pointer(a!, "pointerout", { relatedTarget: rail.outside }), true)
  assert.equal(rail.title(), null)
})

test("pressing, dragging across ticks and leaving clears the hovered preview", async (t) => {
  const rail = await fixture(t)
  const [a, b] = rail.items
  await interact(() => pointer(a!, "pointerover"))
  await interact(() => {
    pointer(a!, "pointerdown", { buttons: 1 })
    pointer(a!, "pointerout", { buttons: 1, relatedTarget: b })
    pointer(b!, "pointerover", { buttons: 1, relatedTarget: a })
  })
  assert.equal(rail.title(), "Alpha")
  await interact(() => pointer(b!, "pointerout", { buttons: 1, relatedTarget: rail.outside }), true)
  assert.equal(rail.title(), null)
})

test("a touch button selects immediately and stays previewed after pointer lift", async (t) => {
  const rail = await fixture(t)
  const a = rail.items[0]!
  await interact(() => {
    pointer(a, "pointerdown", { pointerType: "touch", buttons: 1 })
    a.focus()
    pointer(a, "pointerup", { pointerType: "touch" })
    pointer(a, "pointerout", { pointerType: "touch", relatedTarget: rail.outside })
    click(a)
  })
  assert.deepEqual(rail.selected, ["a"])
  assert.equal(rail.title(), "Alpha")
  await interact(() => pointer(a, "pointerout", { pointerType: "touch", relatedTarget: rail.outside }))
  assert.equal(rail.title(), "Alpha")
})

test("touch links preview on the first tap and activate on the second", async (t) => {
  const rail = await fixture(t, { items: [{ id: "a", label: "Alpha", href: "#alpha" }] })
  const a = rail.items[0]!
  let prevented = false
  await interact(() => {
    pointer(a, "pointerdown", { pointerType: "touch", buttons: 1 })
    prevented = click(a)
  })
  assert.equal(prevented, true)
  assert.deepEqual(rail.selected, [])
  assert.equal(rail.title(), "Alpha")
  await interact(() => {
    pointer(a, "pointerdown", { pointerType: "touch", buttons: 1 })
    prevented = click(a)
  })
  assert.equal(prevented, false)
  assert.deepEqual(rail.selected, ["a"])
  await interact(() => key(window, "Escape"), true)
  await interact(() => {
    pointer(a, "pointerdown", { pointerType: "touch", buttons: 1 })
    prevented = click(a)
  })
  assert.equal(prevented, true, "dismissal resets the second-tap allowance")
  assert.deepEqual(rail.selected, ["a"])
})

test("touch links activate immediately when previews are disabled", async (t) => {
  const rail = await fixture(t, { showPreview: false, items: [{ id: "a", label: "Alpha", href: "#alpha" }] })
  let prevented = false
  await interact(() => {
    pointer(rail.items[0]!, "pointerdown", { pointerType: "touch", buttons: 1 })
    prevented = click(rail.items[0]!)
  })
  assert.equal(prevented, false)
  assert.deepEqual(rail.selected, ["a"])
})

test("a cancelled touch cannot contaminate a later activation", async (t) => {
  const rail = await fixture(t, { items: [{ id: "a", label: "Alpha", href: "#alpha" }] })
  const a = rail.items[0]!
  let prevented = false
  await interact(() => {
    pointer(a, "pointerdown", { pointerType: "touch", buttons: 1 })
    pointer(a, "pointercancel", { pointerType: "touch" })
    prevented = click(a)
  })
  assert.equal(prevented, false)
  assert.deepEqual(rail.selected, ["a"])
  assert.equal(rail.title(), null)
})

test("keyboard and programmatic clicks cannot inherit an unfinished touch", async (t) => {
  const rail = await fixture(t, { items: [{ id: "a", label: "Alpha", href: "#alpha" }] })
  const a = rail.items[0]!
  for (const keyboard of [true, false]) {
    let prevented = false
    await interact(() => {
      pointer(a, "pointerdown", { pointerType: "touch", buttons: 1 })
      if (keyboard) key(a, "Enter")
      prevented = click(a, 0)
    })
    assert.equal(prevented, false)
  }
  assert.deepEqual(rail.selected, ["a", "a"])
  assert.equal(rail.title(), null)
})

test("a click on another item cannot consume an earlier touch press", async (t) => {
  const rail = await fixture(t, { items: [{ id: "a", label: "Alpha", href: "#alpha" }, { id: "b", label: "Bravo", href: "#bravo" }] })
  let prevented = false
  await interact(() => {
    pointer(rail.items[0]!, "pointerdown", { pointerType: "touch", buttons: 1 })
    prevented = click(rail.items[1]!)
  })
  assert.equal(prevented, false)
  assert.deepEqual(rail.selected, ["b"])
  assert.equal(rail.title(), null)
})

test("outside dismissal passes the click through and focus leaving closes a preview", async (t) => {
  const rail = await fixture(t)
  let outsideClicks = 0
  rail.outside.addEventListener("click", () => { outsideClicks++ })
  await interact(() => { key(window, "Tab"); rail.items[0]!.focus() })
  await interact(() => {
    pointer(rail.outside, "pointerdown", { buttons: 1 })
    click(rail.outside)
  }, true)
  assert.equal(rail.title(), null)
  assert.equal(outsideClicks, 1)
  await interact(() => { key(window, "Tab"); rail.items[1]!.focus() })
  assert.equal(rail.title(), "Bravo")
  await interact(() => rail.outside.focus(), true)
  assert.equal(rail.title(), null)
})
