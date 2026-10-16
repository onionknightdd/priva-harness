import { createInstance } from "i18next"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { I18nextProvider, initReactI18next } from "react-i18next"

import { MessageScroller, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport } from "../../../src/components/ui/message-scroller"
import type { AgentThreadMessage } from "../../../src/features/agent-message/agent-message-data"
import { FollowLatestMessage } from "../../../src/features/agent-message/components/follow-latest-message"
import { en } from "../../../src/i18n/locales/en"
import "../../../src/index.css"

const query = new URLSearchParams(location.search)
const reducedMotion = query.has("reduced-motion")
document.documentElement.classList.toggle("dark", query.has("dark"))
if (reducedMotion) {
  const matchMedia = window.matchMedia.bind(window)
  window.matchMedia = (media) => media.includes("prefers-reduced-motion")
    ? Object.assign(new EventTarget(), { matches: true, media, onchange: null, addListener() {}, removeListener() {} }) as MediaQueryList
    : matchMedia(media)
}
const i18n = createInstance()
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
const host = document.querySelector<HTMLDivElement>("#fixtures")!
const results = document.querySelector<HTMLPreElement>("#results")!
const root = createRoot(host)
const browserFrame = window.requestAnimationFrame.bind(window)
const nextFrame = () => new Promise<number>(browserFrame)
type Row = { message: AgentThreadMessage; height: number }
let epoch = 0
let sequence = 0
let mounted = true
let rows: Row[] = initialRows()

function row(role: AgentThreadMessage["role"], height: number): Row {
  sequence += 1
  return { height, message: { id: `scroll-fixture-${sequence}`, role, status: role === "assistant" ? "streaming" : "complete", content: `${role} message ${sequence}`, createdAt: new Date().toISOString() } }
}
function initialRows(): Row[] {
  return [row("user", 180), row("assistant", 320), row("user", 180), row("assistant", 320), row("user", 180), row("assistant", 300)]
}
export function Fixtures() {
  return <I18nextProvider i18n={i18n}>
    <div className="rounded ring-1 ring-border" style={{ height: 400 }}>
      <MessageScrollerProvider autoScroll={false}>
        <MessageScroller>
          <MessageScrollerViewport aria-label="Scroll follow fixture">
            <MessageScrollerContent className="gap-3">
              {mounted ? rows.map(({ message, height }) => <MessageScrollerItem key={message.id} messageId={message.id} className="[content-visibility:visible] border-b p-3" style={{ height }}>
                <p className="text-sm font-medium">{message.content}</p>
                <p className="text-xs text-muted-foreground">{height}px · {message.role}</p>
              </MessageScrollerItem>) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
            <div className="pointer-events-auto"><FollowLatestMessage messages={rows.map(({ message }) => message)} mounted={mounted} /></div>
          </div>
        </MessageScroller>
      </MessageScrollerProvider>
    </div>
  </I18nextProvider>
}
function render() { flushSync(() => root.render(<Fixtures key={epoch} />)) }
function viewport() { return host.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]')! }
function end(element = viewport()) { return element.scrollHeight - element.clientHeight }
function grow(amount = 240) {
  rows = rows.map((entry, index) => index === rows.length - 1
    ? { height: entry.height + amount, message: { ...entry.message, content: `${entry.message.content} · more output` } }
    : entry)
  render()
}
function appendTurn() { rows = [...rows, row("user", 180), row("assistant", 260)]; render() }
function scrollUp(amount = 220) {
  const element = viewport()
  element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -amount }))
  element.scrollTop = Math.max(0, element.scrollTop - amount)
  element.dispatchEvent(new Event("scroll"))
}
function returnToEnd() {
  const element = viewport()
  element.scrollTop = end(element)
  element.dispatchEvent(new Event("scroll"))
}
async function twoFrames() { await nextFrame(); await nextFrame() }
render()

type Point = { at: number; top: number; destination: number; buttonHidden: boolean }
type TimedChange = { at: number; run: () => void }
async function capture(duration: number, mutate: () => void, changes: TimedChange[] = []): Promise<Point[]> {
  const element = viewport()
  const started = performance.now()
  const points: Point[] = []
  let next = 0
  const record = () => {
    const button = host.querySelector<HTMLElement>('[data-slot="message-scroller-button"]')
    points.push({ at: performance.now() - started, top: element.scrollTop, destination: end(element), buttonHidden: !button || getComputedStyle(button).display === "none" })
  }
  record()
  mutate()
  record()
  do {
    const elapsed = performance.now() - started
    while (next < changes.length && elapsed >= changes[next]!.at) {
      changes[next++]!.run()
      record()
    }
    await nextFrame()
    record()
  } while (performance.now() - started < duration)
  return points
}

async function runChecks() {
  let passed = 0
  const reports: string[] = []
  const check = (name: string, condition: boolean) => {
    if (!condition) throw new Error(name)
    passed += 1
  }
  const report = (name: string, points: Point[]) => {
    const reverse = Math.max(0, ...points.slice(1).map((point, index) => points[index]!.top - point.top))
    const intermediate = points.filter((point) => point.top > points[0]!.top + 1 && point.top < point.destination - 1).length
    reports.push(`${name}: ${points.length} samples, ${intermediate} intermediate, maximum reversal ${reverse.toFixed(2)}px`)
    return { reverse, intermediate }
  }
  const follow = async (name: string, mutate: () => void, changes: TimedChange[] = []) => {
    results.textContent = `Running: ${name}\n${reports.join("\n")}`
    const points = await capture(1_150, mutate, changes)
    const metrics = report(name, points)
    check(`${name}: no reverse jump`, metrics.reverse <= 1)
    check(`${name}: reaches the current end`, Math.abs(points.at(-1)!.top - points.at(-1)!.destination) <= 1)
    check(`${name}: following keeps the return button hidden`, points.slice(2).every((point) => point.buttonHidden))
    if (reducedMotion) {
      check(`${name}: reduced motion positions synchronously`, Math.abs(points[1]!.top - points[1]!.destination) <= 1)
    } else {
      check(`${name}: animated intermediate frames exist`, metrics.intermediate > 2)
    }
  }

  try {
    results.textContent = "Running: initial position"
    rows = initialRows()
    mounted = false
    epoch += 1
    render()
    await twoFrames()
    check("preparing leaves the empty viewport at its initial position", viewport().scrollTop === 0)
    mounted = true
    render()
    check("first mounted transcript is positioned synchronously", Math.abs(viewport().scrollTop - end()) <= 1)
    await twoFrames()
    check("fixture uses a 400px viewport", viewport().clientHeight === 400)
    check("initial history is positioned at the end", Math.abs(viewport().scrollTop - end()) <= 1)
    check("items do not enable library scroll anchors", host.querySelectorAll('[data-scroll-anchor="true"]').length === 0)

    await follow("single content growth", () => grow(300))
    await follow("continuous content growth", () => grow(100), [
      { at: 90, run: () => grow(90) }, { at: 180, run: () => grow(90) },
      { at: 270, run: () => grow(90) }, { at: 360, run: () => grow(90) },
    ])

    scrollUp()
    await twoFrames()
    const pausedTop = viewport().scrollTop
    const paused = await capture(700, () => grow(220))
    report("user scroll pauses following", paused)
    check("output growth keeps the user's reading position", paused.every((point) => Math.abs(point.top - pausedTop) <= 1))
    check("return-to-end control is available", host.querySelector('[data-slot="message-scroller-button"][data-active="true"]') !== null)

    returnToEnd()
    await twoFrames()
    await follow("returning to the end resumes following", () => grow(240))

    scrollUp(380)
    await twoFrames()
    const button = host.querySelector<HTMLButtonElement>('[data-slot="message-scroller-button"][data-direction="end"]')!
    check("return-to-end button is active before click", button?.getAttribute("data-active") === "true")
    await follow("button click with streaming growth", () => button.click(), [
      { at: 100, run: () => grow(140) }, { at: 210, run: () => grow(140) },
    ])

    scrollUp(320)
    await twoFrames()
    await follow("new user turn resumes following without anchor jumps", appendTurn)
    check("new user items also leave library anchors disabled", host.querySelectorAll('[data-scroll-anchor="true"]').length === 0)

    if (!reducedMotion) {
      let interruptedTop = 0
      let interruptedAt = Infinity
      const interruption = await capture(1_000, () => grow(400), [
        { at: 120, run: () => { scrollUp(180); interruptedTop = viewport().scrollTop; interruptedAt = performance.now() } },
        { at: 220, run: () => grow(180) },
      ])
      // The capture starts just before the mutation; locate the first manual
      // reverse step instead of relying on timer precision at 120ms.
      const reverseIndex = interruption.findIndex((point, index) => index > 0 && point.top < interruption[index - 1]!.top - 2)
      check("wheel intent interrupts an active glide", Number.isFinite(interruptedAt) && reverseIndex > 0)
      check("interrupted glide stays paused through further growth", interruption.slice(reverseIndex).every((point) => Math.abs(point.top - interruptedTop) <= 1))
      reports.push(`wheel interruption: ${interruption.length} samples, reading position retained`)
    }

    returnToEnd()
    await twoFrames()
    const originalFrame = window.requestAnimationFrame
    const originalCancel = window.cancelAnimationFrame
    const pending = new Set<number>()
    window.requestAnimationFrame = (callback) => {
      const id = originalFrame.call(window, (time) => { pending.delete(id); callback(time) })
      pending.add(id)
      return id
    }
    window.cancelAnimationFrame = (id) => { pending.delete(id); originalCancel.call(window, id) }
    try {
      grow(600)
      await twoFrames()
      flushSync(() => root.render(null))
      await twoFrames()
      check("unmount cancels pending animation frames", pending.size === 0)
      check("unmount removes the scroller", host.querySelector('[data-slot="message-scroller-viewport"]') === null)
    } finally {
      window.requestAnimationFrame = originalFrame
      window.cancelAnimationFrame = originalCancel
      epoch += 1
      render()
    }
    results.textContent = `PASS (${passed} checks; ${reducedMotion ? "reduced" : "normal"} motion)\n${reports.join("\n")}\nInitial position, pause/resume, active interruption, new-turn repinning and unmount cleanup passed.`
  } catch (error) {
    results.textContent = `FAIL after ${passed} checks\n${reports.join("\n")}\n${error instanceof Error ? error.stack : String(error)}`
  }
}

document.querySelector<HTMLButtonElement>("#run")!.addEventListener("click", async () => {
  const controls = [...document.querySelectorAll<HTMLButtonElement>("#run, #grow, #send")]
  controls.forEach((button) => { button.disabled = true })
  try { await runChecks() } finally { controls.forEach((button) => { button.disabled = false }) }
})
document.querySelector<HTMLButtonElement>("#grow")!.addEventListener("click", () => grow())
document.querySelector<HTMLButtonElement>("#send")!.addEventListener("click", appendTurn)
