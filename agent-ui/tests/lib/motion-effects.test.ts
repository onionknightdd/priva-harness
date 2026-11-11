import assert from "node:assert/strict"
import { after, beforeEach, test } from "node:test"
import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" })
for (const key of ["window", "document", "Element", "HTMLElement"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
after(() => dom.window.close())

type Played = { element: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions; cancelled: boolean }
const played: Played[] = []
let reducedMotion = false

// jsdom has no Web Animations: record what each element was asked to play.
dom.window.Element.prototype.animate = function (keyframes, options) {
  const record: Played = { element: this, keyframes: keyframes as Keyframe[], options: options as KeyframeAnimationOptions, cancelled: false }
  played.push(record)
  return { cancel: () => { record.cancelled = true } } as Animation
}
dom.window.matchMedia = (query) => ({ matches: reducedMotion, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, onchange: null })

const { playControlPop, playEnter, playMotion } = await import("../../src/lib/motion-effects")

beforeEach(() => {
  played.length = 0
  reducedMotion = false
  document.body.replaceChildren()
})

function row() {
  return document.body.appendChild(document.createElement("div"))
}

test("a single keyframe is the starting state, eased out over 220ms", () => {
  const element = row()

  playMotion(element, [{ opacity: 0 }])

  assert.equal(played.length, 1)
  assert.equal(played[0].element, element)
  assert.deepEqual(played[0].keyframes, [{ opacity: 0 }])
  assert.equal(played[0].options.duration, 220)
  assert.equal(played[0].options.easing, "cubic-bezier(0.16, 1, 0.3, 1)")
})

test("staggers a list and holds each waiting item at its starting state", () => {
  const rows = [row(), row(), row()]

  playEnter(rows, { y: 8, stagger: 50 })

  assert.deepEqual(played.map((item) => item.options.delay), [0, 50, 100])
  assert.ok(played.every((item) => item.options.fill === "backwards"))
  assert.deepEqual(played[0].keyframes, [{ opacity: 0, translate: "0px 8px" }])
})

test("accepts a NodeList and slides on either axis", () => {
  row().dataset.item = ""
  row().dataset.item = ""

  playEnter(document.querySelectorAll("[data-item]"), { x: -4 })

  assert.equal(played.length, 2)
  assert.deepEqual(played[0].keyframes, [{ opacity: 0, translate: "-4px 0px" }])
})

test("the returned cleanup cancels everything it started", () => {
  const cancel = playEnter([row(), row()])

  cancel()

  assert.ok(played.every((item) => item.cancelled))
})

test("does nothing without a target", () => {
  playMotion(null, [{ opacity: 0 }])()
  playEnter(document.querySelectorAll("[data-missing]"))()

  assert.equal(played.length, 0)
})

test("skips the motion when the user asks for reduced motion", () => {
  reducedMotion = true

  playEnter(row(), { y: 8 })
  playControlPop(row())

  assert.equal(played.length, 0)
})

test("a control pops its icon, or itself when it has none", () => {
  const withIcon = row()
  const icon = withIcon.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "svg"))
  const bare = row()

  playControlPop(withIcon)
  playControlPop(bare)

  assert.equal(played[0].element, icon)
  assert.equal(played[1].element, bare)
  assert.deepEqual(played[0].keyframes, [{ scale: 0.78 }])
  assert.equal(played[0].options.duration, 280)
})
