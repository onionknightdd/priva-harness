import { createInstance } from "i18next"
import { MotionConfig } from "motion/react"
import { StrictMode, useRef } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { I18nextProvider, initReactI18next } from "react-i18next"

import { PreviewRail } from "../../../src/components/motion/preview-rail"
import { UserMessageRail } from "../../../src/features/agent-message/components/user-message-rail"
import type { AgentThreadMessage } from "../../../src/features/agent-message/agent-message-data"
import { activeUserMessageTurnId, scrollUserMessageTurnIntoView } from "../../../src/features/agent-message/user-message-rail"
import { StickyFreeze } from "../../../src/features/agent-message/components/sticky-freeze"
import { MessageScroller, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport } from "../../../src/components/ui/message-scroller"
import "../../../src/index.css"

const query = new URLSearchParams(location.search)
const reduced = query.has("reduced-motion")
document.documentElement.classList.toggle("dark", query.has("dark"))
if (reduced) {
  const matchMedia = window.matchMedia.bind(window)
  window.matchMedia = (media) => media.includes("prefers-reduced-motion")
    ? Object.assign(new EventTarget(), { matches: true, media, onchange: null, addListener() {}, removeListener() {} }) as MediaQueryList
    : matchMedia(media)
}
const i18n = createInstance()
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: {} } } })
const entries = [
  { id: "short", label: "Short reply", reply: "A short reply." },
  { id: "two", label: "Two complete lines", reply: "Two complete lines of text should fit without a trailing suffix." },
  { id: "long", label: "Long English reply", reply: "A longer response that wraps across multiple lines. ".repeat(20) },
  { id: "cjk", label: "中文与 emoji", reply: "预览切换时保持两行摘要，六个点标记被截断的内容。🙂 ".repeat(20) },
  { id: "word", label: "Unbroken text", reply: "abcdef0123456789".repeat(50) },
  { id: "empty", label: "No reply yet", reply: "" },
].map(({ reply, ...entry }, turnIndex) => ({ ...entry, turnIndex, replies: [{
  id: `${entry.id}-reply`, role: "assistant", status: "complete", content: reply, createdAt: "2026-01-01T00:00:00Z",
}] as AgentThreadMessage[] }))
let selected = ""
export function Fixture() {
  const row = useRef<HTMLDivElement>(null)
  return <I18nextProvider i18n={i18n}><MotionConfig reducedMotion={reduced ? "always" : "never"}>
    <div className="@container/agent-message w-[800px]">
      <div ref={row} id="vertical" className="flex h-[320px]">
        <UserMessageRail entries={entries} scrollRootRef={row} onJump={(entry) => { selected = entry.id }} />
      </div>
    </div>
    <PreviewRail items={entries} orientation="horizontal" className="w-[800px]" />
    <div id="jump-fixture" style={{ height: 300, width: 800 }}>
      <MessageScrollerProvider autoScroll={false}>
        <MessageScroller><MessageScrollerViewport><MessageScrollerContent>
          {[0, 1, 2, 3].map((index) => <MessageScrollerItem key={index} messageId={`turn-${index}`}
            data-user-message-turn={`turn-${index}`} className="flex flex-col [content-visibility:visible]">
            <StickyFreeze top={35} className={index === 1 ? "mt-2" : "mt-6"}>
              <div className="rounded bg-card p-3">User turn {index}</div>
            </StickyFreeze>
            <div style={{ height: 420 }}>Long reply {index}</div>
          </MessageScrollerItem>)}
        </MessageScrollerContent></MessageScrollerViewport></MessageScroller>
      </MessageScrollerProvider>
    </div>
  </MotionConfig></I18nextProvider>
}
createRoot(document.querySelector("#fixtures")!).render(<StrictMode><Fixture /></StrictMode>)
const button = document.querySelector<HTMLButtonElement>("#run")!
const results = document.querySelector<HTMLPreElement>("#results")!
const next = () => new Promise<number>(requestAnimationFrame)
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
function pointer(node: Element, type: string, relatedTarget: EventTarget | null) {
  node.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "mouse", pointerId: 1, relatedTarget }))
}
button.onclick = async () => {
  button.disabled = true
  const checks: string[] = []
  const assert = (ok: boolean, label: string) => {
    if (!ok) throw new Error(label)
    checks.push(`PASS ${label}`)
  }
  const rail = document.querySelector<HTMLElement>("#vertical [data-slot=user-message-rail]")!
  const ticks = [...rail.querySelectorAll<HTMLButtonElement>("[data-slot=preview-rail-item]")]
  const description = () => rail.querySelector<HTMLElement>("[data-slot=preview-rail-description]")!
  const card = () => rail.querySelector<HTMLElement>("[data-slot=preview-rail-card]")!
  const height = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight")!
  let reads = 0
  Object.defineProperty(Element.prototype, "scrollHeight", { ...height, get() {
    if ((this as HTMLElement).dataset.slot === "preview-rail-description") reads++
    return height.get!.call(this)
  } })
  let previous: HTMLElement | null = null
  const hover = async (index: number) => {
    const target = ticks[index]!
    flushSync(() => {
      if (previous) pointer(previous, "pointerout", target)
      pointer(target, "pointerover", previous)
    })
    previous = target
    await next()
    await next()
  }
  try {
    await hover(0)
    await next()
    const originalCard = card()
    assert(!!originalCard, "preview opens")
    const gaps: number[] = []
    let time = await next()
    for (let index = 0; index < 48; index++) {
      await hover(index % entries.length)
      const now = performance.now()
      gaps.push(now - time)
      time = now
      if (card() !== originalCard) throw new Error("card remounted during switching")
      if (card().querySelector("[data-slot=preview-rail-title]")?.textContent !== entries[index % entries.length]!.label) throw new Error("preview content lags behind pointer")
    }
    assert(true, "48 switches reuse one card and immediately display the current item")
    assert(reads === 0, "hover never reads reply scrollHeight")
    for (let index = 0; index < 5; index++) {
      await hover(index)
      const node = description()
      const style = getComputedStyle(node)
      const cover = getComputedStyle(node, "::after")
      const suffix = getComputedStyle(node, "::before")
      const line = parseFloat(style.lineHeight)
      assert(node.clientHeight <= line * 2 + 1, `${entries[index]!.id}: reply is at most two lines`)
      const overflowing = index >= 2
      assert(overflowing === (parseFloat(cover.top) >= node.clientHeight), `${entries[index]!.id}: suffix is uncovered only for overflow`)
      assert(suffix.content === '"......"', `${entries[index]!.id}: exact six-dot suffix`)
    }
    ticks[4]!.click()
    assert(selected === entries[4]!.id, "selection still uses the hovered entry")
    await pause(500)
    const tickBox = ticks[4]!.getBoundingClientRect()
    const box = card().getBoundingClientRect()
    assert(Math.abs((tickBox.top + tickBox.bottom - box.top - box.bottom) / 2) < 1, "vertical card settles at tick center")
    if (previous) pointer(previous, "pointerout", document.body)
    pointer(rail.querySelector("nav")!, "pointerout", document.body)
    await pause(200)
    assert(!card(), "leaving the rail removes the preview")
    const horizontal = document.querySelectorAll<HTMLElement>("nav")[1]!
    const horizontalTick = horizontal.querySelectorAll<HTMLElement>("[data-slot=preview-rail-item]")[2]!
    pointer(horizontalTick, "pointerover", document.body)
    await pause(500)
    const horizontalCard = horizontal.parentElement!.querySelector<HTMLElement>("[data-slot=preview-rail-card]")!
    const hTickBox = horizontalTick.getBoundingClientRect()
    const hCardBox = horizontalCard.getBoundingClientRect()
    assert(Math.abs((hTickBox.left + hTickBox.right - hCardBox.left - hCardBox.right) / 2) < 1, "horizontal card settles at tick center")
    pointer(horizontalTick, "pointerout", document.body)
    pointer(horizontal, "pointerout", document.body)
    const viewport = document.querySelector<HTMLElement>("#jump-fixture [data-slot=message-scroller-viewport]")!
    const turns = [...viewport.querySelectorAll<HTMLElement>("[data-user-message-turn]")]
    viewport.scrollTop = viewport.scrollHeight
    await next()
    for (const index of [0, 2, 1]) {
      assert(scrollUserMessageTurnIntoView(viewport, `turn-${index}`), `jump ${index}: destination exists`)
      await next()
      await next()
      const top = turns[index]!.firstElementChild!.getBoundingClientRect().top - viewport.getBoundingClientRect().top
      assert(Math.abs(top - 35) < 1, `jump ${index}: sticky user starts below header`)
      assert(activeUserMessageTurnId(viewport) === `turn-${index}`, `jump ${index}: active tick uses the same anchor`)
    }
    const destination = turns[2]!
    const animation = destination.animate([{ transform: "translateY(-200px)" }, { transform: "translateY(0px)" }], { duration: 200 })
    await next()
    scrollUserMessageTurnIntoView(viewport, "turn-2")
    await animation.finished
    await next()
    assert(Math.abs(destination.firstElementChild!.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 35) < 1,
      "jump during layout animation keeps the final destination aligned")
    await hover(2)
    await pause(500)
    const sorted = gaps.sort((a, b) => a - b)
    results.textContent = `${checks.join("\n")}\n${checks.length} checks passed; reduced motion: ${reduced}\n48-switch median ${sorted[24]!.toFixed(1)}ms, p95 ${sorted[45]!.toFixed(1)}ms`
  } catch (error) {
    results.textContent = `${checks.join("\n")}\nFAIL ${String(error)}`
  } finally {
    Object.defineProperty(Element.prototype, "scrollHeight", height)
    button.disabled = false
  }
}
