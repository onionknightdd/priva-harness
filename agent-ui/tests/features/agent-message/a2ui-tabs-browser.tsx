import { StrictMode, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { AgentToRendererMessageSchema } from "@a2ui/web_core/v1_0"

import "@/index.css"
import { A2uiVisual, type A2uiAction } from "@/features/agent-message/a2ui/a2ui-visual"
import tabsResult from "../../fixtures/a2ui/tabs.json"

const query = new URLSearchParams(location.search)
document.documentElement.classList.toggle("dark", query.has("dark"))
if (query.has("reduced-motion")) {
  const matchMedia = window.matchMedia.bind(window)
  window.matchMedia = (media) => {
    const result = matchMedia(media)
    if (media.includes("prefers-reduced-motion")) Object.defineProperty(result, "matches", { value: true })
    return result
  }
}
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
const messages = tabsResult.messages.map((message) => AgentToRendererMessageSchema.parse(message))
const longMessages = structuredClone(messages)
for (const message of longMessages) {
  if (!("createSurface" in message)) continue
  const tabs = message.createSurface.components?.find((component) => component.component === "Tabs")
  if (tabs) tabs.tabs = [
    { title: "Sales overview and quarterly performance", child: "overview" },
    { title: "Regional revenue and territory targets", child: "regions" },
    { title: "Report preferences and submission", child: "report" },
  ]
}
let documentTransitionCalls = 0
if (document.startViewTransition) {
  const startViewTransition = document.startViewTransition.bind(document)
  document.startViewTransition = (...args) => {
    documentTransitionCalls += 1
    return startViewTransition(...args)
  }
}
const wait = (ms = 20) => new Promise<void>((resolve) => setTimeout(resolve, ms))
async function until(condition: () => boolean, message: string) {
  const deadline = performance.now() + 3000
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(message)
    await wait(10)
  }
}
function tabs() { return Array.from(document.querySelectorAll<HTMLButtonElement>('#dashboard-fixture [role="tab"]')) }
function panel(index: number) { return document.getElementById(tabs()[index]?.getAttribute("aria-controls") ?? "") }
function visible(index: number) {
  const element = panel(index)
  return !!element && !element.hidden && !element.hasAttribute("inert") && element.getBoundingClientRect().height > 0
}
function pointerSelect(index: number) {
  const target = tabs()[index]
  target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }))
  target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
  target.focus({ preventScroll: true })
  target.click()
}
function panelAnimations(index: number) {
  return panel(index)?.getAnimations().filter((animation) => (animation.effect as KeyframeEffect | null)?.target === panel(index)) ?? []
}
function localAnimations() { return [0, 1, 2].flatMap(panelAnimations) }
async function settled(animations = localAnimations()) {
  await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)))
  await wait()
}
async function pauseAtMidpoint() {
  const animations = localAnimations().filter((animation) => animation.playState === "running" || animation.pending)
  for (const animation of animations) {
    animation.pause()
    animation.currentTime = Number(animation.effect!.getTiming().duration) / 2
  }
  await wait()
  return animations
}

export function Fixture() {
  const [narrow, setNarrow] = useState(query.has("narrow"))
  const [dark, setDark] = useState(query.has("dark"))
  const [longLabels, setLongLabels] = useState(false)
  const [shown, setShown] = useState(true)
  const [generation, setGeneration] = useState(0)
  const [result, setResult] = useState("Ready — real compiler output, no Runner or model calls.")
  const [running, setRunning] = useState(false)
  const [holding, setHolding] = useState(false)
  const heldAnimations = useRef<Animation[]>([])
  const actions = useRef<A2uiAction[]>([])
  const [actionCount, setActionCount] = useState(0)
  const [revision, setRevision] = useState(0)
  const onAction = (action: A2uiAction) => { actions.current.push(action); setActionCount(actions.current.length) }
  const inspect = async () => {
    if (holding) {
      heldAnimations.current.forEach((animation) => animation.play())
      heldAnimations.current = []
      setHolding(false)
      return
    }
    await settled()
    pointerSelect(visible(0) ? 1 : 0)
    await until(() => localAnimations().length > 0, "No local slide to inspect")
    heldAnimations.current = await pauseAtMidpoint()
    setHolding(true)
  }

  const run = async () => {
    setRunning(true)
    setResult("Running…")
    const passed: string[] = []
    const check = (condition: unknown, message: string) => {
      if (!condition) throw new Error(message)
      passed.push(`PASS ${message}`)
    }
    try {
      await settled()
      flushSync(() => { setShown(true); setLongLabels(false); setGeneration((value) => value + 1) })
      actions.current = []
      setActionCount(0)
      await until(() => visible(0), "Initial overview did not render")
      await wait(50)
      const viewport = document.getElementById("chat-viewport")!
      viewport.scrollTop = 0
      check(localAnimations().length === 0, "Initial history render does not animate")
      const bar = document.querySelector<HTMLElement>(".a2ui-tabs-list")!
      const original = bar.getBoundingClientRect()
      const select = async (index: number) => {
        pointerSelect(index)
        await until(() => visible(index), `Panel ${index} did not become visible`)
        if (!reducedMotion) await until(() => panelAnimations(index).length > 0, "Incoming panel did not animate locally")
        return localAnimations()
      }
      const assertSlide = (direction: 1 | -1, incomingIndex: number, outgoingIndex: number) => {
        const incoming = panelAnimations(incomingIndex)
        const outgoing = panelAnimations(outgoingIndex)
        check(incoming.length > 0 && outgoing.length > 0, "Incoming and outgoing panels animate as local DOM elements")
        const from = incoming.map((animation) => (animation.effect as KeyframeEffect).getKeyframes()[0])
        const to = outgoing.map((animation) => (animation.effect as KeyframeEffect).getKeyframes().at(-1)!)
        check(from.some((frame) => frame.transform && new DOMMatrixReadOnly(String(frame.transform)).m41 === direction * 60), `${direction > 0 ? "Forward" : "Backward"} content enters from the correct side at 60px`)
        check(to.some((frame) => frame.transform && new DOMMatrixReadOnly(String(frame.transform)).m41 === -direction * 60), "Outgoing content slides in the opposite direction")
        check(from.some((frame) => Number(frame.opacity) === 0) && to.some((frame) => Number(frame.opacity) === 0), "Slide includes entrance and exit fades")
        check(incoming.every((animation) => Number(animation.effect!.getTiming().duration) <= 300), "Content entrance completes within 300ms")
        check(panel(outgoingIndex)!.hasAttribute("inert"), "The outgoing animated panel cannot receive focus")
      }
      const assertComposerClear = (label: string) => {
        const controls = Array.from(document.querySelectorAll<HTMLElement>("#chat-composer input, #chat-composer button"))
        check(controls.every((control) => {
          const bounds = control.getBoundingClientRect()
          const top = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
          return top === control || !!top && control.contains(top)
        }), `The composer stays unobscured ${label}`)
      }
      const assertClipping = () => {
        const content = document.querySelector<HTMLElement>(".a2ui-tabs-content")!
        const composer = document.getElementById("chat-composer")!
        check(viewport.contains(content) && ["auto", "scroll"].includes(getComputedStyle(viewport).overflowY), "The animated content remains inside the clipped conversation viewport")
        check(getComputedStyle(content).position === "relative" && ["clip", "hidden"].includes(getComputedStyle(content).overflowX), "Panel clipping belongs to its local positioned container")
        check(viewport.getBoundingClientRect().bottom <= composer.getBoundingClientRect().top + 1, "The composer is outside the conversation clipping rectangle")
        check(localAnimations().every((animation) => {
          const effect = animation.effect as KeyframeEffect
          return !effect.pseudoElement && effect.target instanceof HTMLElement && content.contains(effect.target) && getComputedStyle(effect.target).position !== "fixed"
        }), "Every animation targets a normal descendant rather than a top-layer or fixed snapshot")
      }

      const previousContentHeight = panel(0)!.getBoundingClientRect().height
      const forward = await select(1)
      assertComposerClear("during the tall-to-short slide")
      check(documentTransitionCalls === 0, "Dashboard switching never calls document.startViewTransition")
      if (!reducedMotion) {
        assertSlide(1, 1, 0)
        const content = document.querySelector<HTMLElement>(".a2ui-tabs-content")!
        const currentContentHeight = content.getBoundingClientRect().height
        check(previousContentHeight > currentContentHeight + 24, "The height regression switches from a tall chart to a shorter table")
        check(Math.abs(panel(0)!.getBoundingClientRect().height - previousContentHeight) < 1, "The outgoing chart keeps its original height instead of being squashed")
        check(Math.abs(panel(1)!.getBoundingClientRect().height - currentContentHeight) < 1, "The incoming table defines the content height")
        check(["clip", "hidden"].includes(getComputedStyle(content).overflowX), "Animated panels clip at the content boundary")
        check(bar.getAnimations().length === 0, "The tab strip stays outside the animated panels")
      } else {
        check(localAnimations().length === 0, "Reduced motion switches content instantly")
      }
      const pausedForward = await pauseAtMidpoint()
      assertClipping()
      assertComposerClear("at the paused midpoint of the tall-to-short slide")
      if (!reducedMotion) check(Math.abs(panel(0)!.getBoundingClientRect().height - previousContentHeight) < 1, "Pausing the outgoing chart does not distort its height")
      pausedForward.forEach((animation) => animation.play())
      await settled(forward)
      const backward = await select(0)
      if (!reducedMotion) assertSlide(-1, 0, 1)
      assertComposerClear("during the short-to-tall slide")
      const pausedBackward = await pauseAtMidpoint()
      assertComposerClear("at the paused midpoint of the short-to-tall slide")
      pausedBackward.forEach((animation) => animation.play())
      await settled(backward)
      const bounds = bar.getBoundingClientRect()
      check(Math.abs(bounds.y - original.y) < 1 && Math.abs(bounds.height - original.height) < 1, "Content changes never move or resize the tab strip")

      viewport.scrollTop = Math.min(96, (viewport.scrollHeight - viewport.clientHeight) / 2)
      check(viewport.scrollTop > 0, "Composer regression also runs with the conversation scrolled")
      const middleForward = await select(1)
      assertComposerClear("after scrolling into the tall-to-short slide")
      const pausedMiddle = await pauseAtMidpoint()
      assertClipping()
      assertComposerClear("at the paused midpoint of the scrolled tall-to-short slide")
      pausedMiddle.forEach((animation) => animation.play())
      await settled(middleForward)
      const middleBackward = await select(0)
      assertComposerClear("after scrolling into the short-to-tall slide")
      await settled(middleBackward)
      viewport.scrollTop = 0

      await settled(await select(2))
      const input = panel(2)!.querySelector<HTMLInputElement>("input")!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Retained Tabs draft")
      input.dispatchEvent(new Event("input", { bubbles: true }))
      await wait()
      await settled(await select(0))
      check(input.isConnected && input.closest('[hidden][inert]'), "Inactive form stays mounted and cannot receive focus")
      await settled(await select(2))
      flushSync(() => setRevision((value) => value + 1))
      check(panel(2)!.querySelector("input") === input && input.value === "Retained Tabs draft", "Returning and rerendering preserve the same input and its value")
      check(actions.current.length === 0, "Local tab changes never dispatch an agent action")
      panel(2)!.querySelector<HTMLButtonElement>(".a2ui-action button")!.click()
      await until(() => actions.current.length === 1, "Report button did not dispatch its action")
      check(actions.current[0].context.title === "Retained Tabs draft", "Explicit submission carries the edited bound value")

      pointerSelect(0)
      await wait(25)
      pointerSelect(1)
      await wait(25)
      pointerSelect(2)
      await until(() => visible(2), "Rapid switching did not settle on Report")
      await wait(350)
      check(tabs()[2].getAttribute("aria-selected") === "true" && [0, 1, 2].filter(visible).length === 1, "Rapid navigation leaves exactly the latest panel visible")
      flushSync(() => pointerSelect(0))
      flushSync(() => pointerSelect(2))
      await wait(350)
      check(visible(2) && !visible(0), "Rapid A to B to A retains the final A")
      check(!document.querySelector('.a2ui-tabs-panel[data-exiting="true"]'), "Interrupted transitions leave no obsolete outgoing panel")

      const target = tabs()[2]
      target.focus({ preventScroll: true })
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }))
      await until(() => visible(0), "Home key did not reveal Overview")
      check(localAnimations().length === 0 && document.activeElement === tabs()[0], "Keyboard changes are immediate and keep focus on the selected tab")
      const visual = document.querySelector<HTMLElement>('[data-slot="a2ui-visual"]')!
      check(visual.scrollWidth <= visual.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth, "The dashboard stays within its conversation width")

      flushSync(() => { setLongLabels(true); setNarrow(true) })
      await until(() => tabs()[0]?.textContent?.includes("quarterly") === true, "Long-label fixture did not render")
      const overflowList = document.querySelector<HTMLElement>(".a2ui-tabs-list")!
      check(overflowList.scrollWidth > overflowList.clientWidth, "Long labels scroll within the narrow tab strip")
      tabs()[0].focus({ preventScroll: true })
      tabs()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }))
      await until(() => visible(2), "End key did not reveal the overflow tab")
      const last = tabs()[2].getBoundingClientRect()
      const strip = overflowList.getBoundingClientRect()
      check(last.left >= strip.left - 1 && last.right <= strip.right + 1, "Keyboard focus reveals the overflow label without widening the conversation")

      flushSync(() => { setLongLabels(false); setNarrow(query.has("narrow")); setGeneration((value) => value + 1) })
      await until(() => visible(0) && tabs()[0].textContent === "Overview", "Default fixture did not restore")
      const unmountAnimations = await select(1)
      flushSync(() => setShown(false))
      await wait(50)
      check(unmountAnimations.every((animation) => animation.playState === "idle" || animation.playState === "finished"), "Unmounting during a slide cancels local animations")
      check(documentTransitionCalls === 0 && !document.documentElement.hasAttribute("data-page-transition"), "The chat never creates a document-wide transition layer")
      flushSync(() => setShown(true))
      await until(() => visible(0), "Preview did not restore after unmount check")
      check(!document.querySelector('#dashboard-fixture [role="alert"]'), "No renderer errors")
      viewport.scrollTop = 0
      setResult(`${passed.join("\n")}\n${reducedMotion ? "Reduced motion: all switches were instant." : "Local directional slide and composer clipping verified."}`)
    } catch (error) {
      setResult(`${passed.join("\n")}\nFAIL ${error instanceof Error ? error.stack : String(error)}`)
    } finally { setRunning(false) }
  }

  return <main className="min-h-screen bg-background p-5 text-foreground">
    <div className="mx-auto mb-5 flex max-w-3xl flex-wrap items-center gap-2 text-sm">
      <strong className="mr-2">Agent dashboard · Tabs</strong>
      <button disabled={running || holding} onClick={() => void run()} className="rounded-md border px-3 py-1.5 disabled:opacity-50">Run Tabs checks</button>
      <button disabled={running || reducedMotion} onClick={() => void inspect().catch((error) => setResult(`FAIL ${String(error)}`))} className="rounded-md border px-3 py-1.5">{holding ? "Resume slide" : "Inspect slide"}</button>
      <button disabled={running || holding} onClick={() => setNarrow((value) => !value)} className="rounded-md border px-3 py-1.5">{narrow ? "Wide" : "Narrow"}</button>
      <button disabled={running || holding} onClick={() => { setDark(!dark); document.documentElement.classList.toggle("dark", !dark) }} className="rounded-md border px-3 py-1.5">Theme: {dark ? "dark" : "light"}</button>
      <button disabled={running || holding} onClick={() => setGeneration((value) => value + 1)} className="rounded-md border px-3 py-1.5">Replay</button>
      <span className="text-muted-foreground">{reducedMotion ? "Reduced motion" : "Directional slide"} · Actions {actionCount}</span>
    </div>
    <section id="chat-shell" className="mx-auto grid grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-xl border bg-background" style={{ width: narrow ? 380 : 808, maxWidth: "100%", height: "min(620px, calc(100svh - 200px))", minHeight: 320 }}>
      <div id="chat-viewport" data-slot="message-scroller-viewport" className="min-h-0 overflow-auto p-4 [overflow-anchor:none]">
        <div id="dashboard-fixture" data-revision={revision} className="mx-auto max-w-3xl">
          <p className="mb-3 text-sm">Here is the quarterly sales report. Use the tabs to explore the overview, regional details and report options.</p>
          <p className="mb-5 text-sm text-muted-foreground">The conversation scrolls above the composer. Dashboard animations should stay inside this reply.</p>
          {shown && <A2uiVisual key={generation} messages={longLabels ? longMessages : messages} onAction={onAction} />}
          <div className="mt-5 space-y-4 text-sm text-muted-foreground">
            <p>Revenue finished above target, with the strongest contribution coming from North America.</p>
            <p>Europe remained stable through the quarter and maintained a consistent regional mix.</p>
            <p>Asia Pacific showed the largest opportunity for additional coverage next quarter.</p>
            <p>The regional table provides exact values behind the overview chart and headline metrics.</p>
            <p>Report settings stay available while you compare different tabs, so unfinished edits are retained.</p>
            <p>Ask a follow-up question below to explore a region or prepare the next quarterly report.</p>
          </div>
        </div>
      </div>
      <form id="chat-composer" className="relative flex items-center gap-2 border-t bg-background p-4" onSubmit={(event) => event.preventDefault()}>
        <input aria-label="Message" placeholder="Ask about this report…" className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-3 text-sm" />
        <button type="submit" className="rounded-lg bg-primary px-4 py-3 text-sm text-primary-foreground">Send</button>
      </form>
    </section>
    <pre id="results" role="status" className="mx-auto mt-6 max-w-3xl whitespace-pre-wrap text-xs leading-5">{result}</pre>
  </main>
}

const root = createRoot(document.getElementById("root")!)
root.render(<StrictMode><Fixture /></StrictMode>)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
