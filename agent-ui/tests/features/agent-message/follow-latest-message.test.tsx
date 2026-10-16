import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

import type { AgentThreadMessage } from "../../../src/features/agent-message/agent-message-data.ts"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "Element", "Node", "DocumentFragment", "ShadowRoot", "SVGElement", "Event", "KeyboardEvent", "MouseEvent", "FocusEvent", "MutationObserver"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}

let now = 1_000
let frameId = 0
let reducedMotion = false
const frames = new Map<number, FrameRequestCallback>()
const originalPerformance = globalThis.performance
Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => now } })
const requestFrame = (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId }
const cancelFrame = (id: number) => { frames.delete(id) }

class ControlledResizeObserver {
  static instances = new Set<ControlledResizeObserver>()
  targets = new Set<Element>()
  constructor(readonly callback: ResizeObserverCallback) { ControlledResizeObserver.instances.add(this) }
  observe(element: Element) { this.targets.add(element) }
  unobserve(element: Element) { this.targets.delete(element) }
  disconnect() { this.targets.clear(); ControlledResizeObserver.instances.delete(this) }
}

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: requestFrame,
  cancelAnimationFrame: cancelFrame,
  ResizeObserver: ControlledResizeObserver,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
})
Object.assign(window, { requestAnimationFrame: requestFrame, cancelAnimationFrame: cancelFrame })
dom.window.matchMedia = (query) => ({ matches: reducedMotion, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, onchange: null })

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { I18nextProvider, initReactI18next } = await import("react-i18next")
const i18n = (await import("i18next")).createInstance()
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: { agentMessage: { scrollToLatest: "Scroll to latest" } } } } })
const {
  MessageScrollerProvider, MessageScroller, MessageScrollerViewport,
  MessageScrollerContent, MessageScrollerItem,
} = await import("../../../src/components/ui/message-scroller.tsx")
const { FollowLatestMessage } = await import("../../../src/features/agent-message/components/follow-latest-message.tsx")
const { captureExpandTrigger, releaseThreadFollow, resetExpandAnchor } = await import("../../../src/features/agent-message/expand-down-anchor.ts")

after(() => {
  dom.window.close()
  Object.defineProperty(globalThis, "performance", { configurable: true, value: originalPerformance })
})

function message(id = "assistant", role: AgentThreadMessage["role"] = "assistant"): AgentThreadMessage {
  return { id, role, content: "Example", createdAt: "2026-10-17T00:00:00.000Z", status: "streaming" }
}

type Row = { id: string; height: number }
type ScrollWrite = { kind: "animation" | "library"; from: number; to: number; behavior?: ScrollBehavior }

// Real React components and the installed scroller run against controlled
// geometry and animation frames; no production scrolling logic is duplicated.
async function mount(options: { mounted?: boolean; reduce?: boolean } = {}) {
  frames.clear()
  resetExpandAnchor()
  reducedMotion = options.reduce ?? false
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  let mounted = options.mounted ?? true
  let rows: Row[] = mounted ? [{ id: "assistant", height: 1000 }] : []
  let messages = [message()]
  let top = 0
  let pendingScroll = false
  let viewport: HTMLElement
  let content: HTMLElement
  const writes: ScrollWrite[] = []
  const contentHeight = () => Math.max(400, rows.reduce((height, row) => height + row.height, 0))
  const end = () => contentHeight() - 400
  const rect = (y: number, height: number) => ({ x: 0, y, top: y, left: 0, right: 500, bottom: y + height, width: 500, height, toJSON() { return this } })
  const setTop = (value: number, kind: ScrollWrite["kind"], behavior?: ScrollBehavior) => {
    const next = Math.min(end(), Math.max(0, value))
    writes.push({ kind, from: top, to: next, behavior })
    pendingScroll ||= top !== next
    top = next
  }
  const viewportRef = (node: HTMLDivElement | null) => {
    if (!node) return
    viewport = node
    Object.defineProperties(node, {
      clientHeight: { configurable: true, get: () => 400 },
      scrollHeight: { configurable: true, get: contentHeight },
      scrollTop: { configurable: true, get: () => top, set: (value) => setTop(value, "animation") },
    })
    node.getBoundingClientRect = () => rect(0, 400)
    node.scrollTo = ((options: ScrollToOptions) => setTop(options.top ?? top, "library", options.behavior)) as typeof node.scrollTo
  }
  const contentRef = (node: HTMLDivElement | null) => {
    if (!node) return
    content = node
    node.getBoundingClientRect = () => rect(-top, contentHeight())
  }
  const render = async () => {
    await act(async () => root.render(
      <I18nextProvider i18n={i18n}>
        <MessageScrollerProvider autoScroll={false} scrollMargin={35}>
          <MessageScroller>
            <MessageScrollerViewport ref={viewportRef}>
              <MessageScrollerContent ref={contentRef}>
                {rows.map((row) => (
                  <MessageScrollerItem key={row.id} messageId={row.id} ref={(node) => {
                    if (node) node.getBoundingClientRect = () => {
                      const index = rows.findIndex((candidate) => candidate.id === row.id)
                      return rect(rows.slice(0, index).reduce((height, candidate) => height + candidate.height, 0) - top, rows[index]?.height ?? 0)
                    }
                  }}>Example content</MessageScrollerItem>
                ))}
                <div data-slot="thread-end-spacer" aria-hidden />
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <FollowLatestMessage messages={messages} mounted={mounted} />
          </MessageScroller>
        </MessageScrollerProvider>
      </I18nextProvider>
    ))
  }
  const scrollEvent = () => {
    if (pendingScroll) { pendingScroll = false; viewport.dispatchEvent(new Event("scroll")) }
  }
  const frame = async (milliseconds = 16) => {
    now += milliseconds
    await act(async () => {
      scrollEvent()
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback(now)
    })
  }
  const resize = async () => {
    await act(async () => {
      for (const observer of ControlledResizeObserver.instances) {
        if (observer.targets.has(content)) observer.callback([{ target: content } as ResizeObserverEntry], observer as unknown as ResizeObserver)
      }
    })
  }
  await render()
  await frame()
  writes.length = 0
  return {
    host, viewport: viewport!, content: content!, writes, frame, resize,
    get top() { return top }, end,
    async grow(height: number, nextMessages = messages) {
      rows = [...rows.slice(0, -1), { ...rows.at(-1)!, height }]
      messages = nextMessages
      await render()
      await resize()
    },
    async reveal() { mounted = true; rows = [{ id: "assistant", height: 1000 }]; await render(); await resize() },
    async appendUser() { rows = [...rows, { id: "user", height: 200 }]; messages = [...messages, message("user", "user")]; await render(); await resize() },
    async prepend() { rows = [{ id: "older", height: 800 }, ...rows]; await render(); await resize() },
    async pause(position: number) {
      await act(async () => {
        viewport.dispatchEvent(new dom.window.WheelEvent("wheel", { bubbles: true, deltaY: -100 }))
        setTop(position, "animation")
        scrollEvent()
      })
      writes.length = 0
    },
    async clickLatest() { await act(async () => host.querySelector<HTMLButtonElement>('[data-slot="message-scroller-button"]')!.click()) },
    async close() { await act(async () => root.unmount()); host.remove(); resetExpandAnchor() },
  }
}

function monotonic(writes: ScrollWrite[]) {
  assert.ok(writes.every(({ from, to }) => to >= from), `scroll reversed: ${JSON.stringify(writes)}`)
}

test("streaming growth uses intermediate frames without an instant jump or reversal", async () => {
  const view = await mount()
  try {
    assert.equal(view.top, 600)
    await view.grow(1200, [message()])
    await view.frame()
    assert.ok(view.top > 600 && view.top < 800)
    await view.frame()
    await view.grow(1400, [message()])
    for (let index = 0; index < 40; index++) await view.frame()
    assert.equal(view.top, 1000)
    monotonic(view.writes)
    assert.equal(view.writes.some(({ kind }) => kind === "library"), false)
  } finally { await view.close() }
})

test("preparation does not consume the immediate first history position", async () => {
  const view = await mount({ mounted: false })
  try {
    await view.resize()
    await view.frame()
    await view.reveal()
    assert.equal(view.top, 600)
    await view.frame()
    view.writes.length = 0
    await view.grow(1200, [message()])
    await view.frame()
    assert.ok(view.top > 600 && view.top < 800)
  } finally { await view.close() }
})

test("manual scrolling pauses follow and the button resumes the same glide during streaming", async () => {
  const view = await mount()
  try {
    const button = view.host.querySelector<HTMLButtonElement>('[data-slot="message-scroller-button"]')!
    assert.equal(button.classList.contains("hidden"), true)
    await view.grow(1200, [message()])
    await view.frame(80)
    await view.pause(200)
    assert.equal(button.classList.contains("hidden"), false)
    await view.grow(1400, [message()])
    await view.frame(100)
    assert.equal(view.top, 200)
    await view.clickLatest()
    assert.equal(button.classList.contains("hidden"), true)
    await view.frame()
    assert.ok(view.top > 200 && view.top < 1000)
    await view.grow(1600, [message()])
    for (let index = 0; index < 60; index++) await view.frame()
    assert.equal(view.top, 1200)
    monotonic(view.writes)
    assert.equal(view.writes.some(({ kind }) => kind === "library"), false)
  } finally { await view.close() }
})

test("a new user message resumes paused follow without library anchor jumps", async () => {
  const view = await mount()
  try {
    await view.pause(200)
    await view.appendUser()
    assert.equal(view.top, 200)
    await view.frame()
    assert.ok(view.top > 200 && view.top < 800)
    for (let index = 0; index < 60; index++) await view.frame()
    assert.equal(view.top, 800)
    monotonic(view.writes)
    assert.equal(view.writes.some(({ kind }) => kind === "library"), false)
  } finally { await view.close() }
})

test("prepending history preserves the already visible message position", async () => {
  const view = await mount()
  try {
    const current = view.host.querySelector<HTMLElement>('[data-message-id="assistant"]')!
    const before = current.getBoundingClientRect().top
    await view.prepend()
    await view.frame()
    assert.equal(view.top, 1400)
    assert.equal(current.getBoundingClientRect().top, before)
    monotonic(view.writes)
  } finally { await view.close() }
})

test("expanding a disclosure stops an active glide and holds follow during the lock", async () => {
  const view = await mount()
  try {
    await view.grow(1200, [message()])
    await view.frame(80)
    const trigger = view.content.appendChild(document.createElement("button"))
    trigger.setAttribute("aria-expanded", "false")
    await act(async () => { captureExpandTrigger(trigger); releaseThreadFollow(view.viewport) })
    const stoppedAt = view.top
    await view.grow(1400, [message()])
    await view.frame(100)
    assert.equal(view.top, stoppedAt)
  } finally { await view.close() }
})

test("explicit resume overrides an active disclosure lock for the button and a new user message", async () => {
  for (const resume of ["button", "user"] as const) {
    const view = await mount()
    try {
      await view.pause(200)
      const trigger = view.content.appendChild(document.createElement("button"))
      trigger.setAttribute("aria-expanded", "false")
      await act(async () => { captureExpandTrigger(trigger); releaseThreadFollow(view.viewport) })
      if (resume === "button") await view.clickLatest()
      else await view.appendUser()
      await view.frame()
      assert.ok(view.top > 200, `${resume} should resume before the disclosure lock expires`)
      for (let index = 0; index < 60; index++) await view.frame()
      assert.equal(view.top, view.end())
      monotonic(view.writes)
    } finally { await view.close() }
  }
})

test("reduced motion follows growth immediately", async () => {
  const view = await mount({ reduce: true })
  try {
    await view.grow(1200, [message()])
    assert.equal(view.top, 800)
    await view.frame()
    assert.equal(view.top, 800)
  } finally { await view.close() }
})

test("unmount cancels the active glide and disconnects resize observers", async () => {
  const view = await mount()
  await view.grow(1200, [message()])
  await view.frame(80)
  await view.close()
  const count = view.writes.length
  await view.frame(1000)
  assert.equal(view.writes.length, count)
  assert.equal(ControlledResizeObserver.instances.size, 0)
})

test("the thread leaves automatic scrolling and turn anchoring to its follow controller", async () => {
  const source = await readFile(new URL("../../../src/features/agent-message/components/agent-message-thread.tsx", import.meta.url), "utf8")
  assert.match(source, /<MessageScrollerProvider\s+autoScroll=\{false\}/)
  assert.doesNotMatch(source, /scrollAnchor=\{freezeTurn\}/)
})
