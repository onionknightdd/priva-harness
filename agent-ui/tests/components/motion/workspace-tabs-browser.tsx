import { useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { MotionConfig } from "motion/react"
import { FilesIcon, ListTodoIcon, MonitorIcon, PresentationIcon } from "lucide-react"
import { ExpandableTabs } from "../../../src/components/motion/expandable-tabs"
import { TooltipProvider } from "../../../src/components/ui/tooltip"
import "../../../src/index.css"

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
const nativeTransitions: ViewTransition[] = []
let initialTransitionCount = 0
if (document.startViewTransition) {
  const startViewTransition = document.startViewTransition.bind(document)
  document.startViewTransition = (...args) => {
    const transition = startViewTransition(...args)
    nativeTransitions.push(transition)
    void transition.ready.catch(() => undefined)
    return transition
  }
}
const computer = { mounted: 0, unmounted: 0 }
const wait = (ms = 30) => new Promise<void>((resolve) => setTimeout(resolve, ms))
async function until(condition: () => boolean, message: string) {
  const deadline = performance.now() + 3000
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(message)
    await wait(10)
  }
}
function check(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}
function visibleView(id: string) {
  const element = document.querySelector<HTMLElement>(`[data-view="${id}"]`)
  return !!element && element.getBoundingClientRect().height > 0
}
function tab(id: string) {
  return document.querySelector<HTMLButtonElement>(`[role="tab"][aria-label="${id}"]`)!
}
function pointerSelect(id: string) {
  const button = tab(id)
  button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }))
  button.click()
}
function pageAnimations() {
  return document.getAnimations().filter((animation) => {
    const effect = animation.effect as KeyframeEffect | null
    return effect?.pseudoElement?.includes("view-transition") && !effect.pseudoElement.includes("(root)")
  })
}
export function Computer() {
  useEffect(() => {
    computer.mounted++
    return () => { computer.unmounted++ }
  }, [])
  return <div data-view="Computer" className="flex h-full items-center justify-center bg-muted text-sm">
    <div className="rounded-lg border bg-background p-8 text-center">
      <MonitorIcon className="mx-auto mb-3 size-10" />
      Isolated desktop connection
    </div>
  </div>
}
export function Fixture() {
  const [active, setActive] = useState<string | null>("Tasks")
  const [narrow, setNarrow] = useState(query.has("narrow"))
  const [result, setResult] = useState("Ready — this fixture does not contact a Runner or model.")
  const [running, setRunning] = useState(false)
  useEffect(() => { initialTransitionCount = nativeTransitions.length }, [])
  const items = useMemo(() => [
    { id: "Tasks", label: "Tasks", icon: <ListTodoIcon />, content: <div data-view="Tasks" className="h-full space-y-3 overflow-auto bg-background p-5">
      <h2 className="text-lg font-medium">Tasks and activity</h2>
      {["Inspect workspace", "Implement page zoom", "Verify lifecycle"].map((task, index) => <div key={task} className="rounded-lg border p-4"><span className="mr-3 text-muted-foreground">0{index + 1}</span>{task}</div>)}
    </div> },
    { id: "Files", label: "Files", icon: <FilesIcon />, keepMounted: true, content: <div data-view="Files" className="flex h-full flex-col gap-4 bg-background p-5">
      <h2 className="text-lg font-medium">Retained file editor</h2>
      <label className="flex flex-col gap-2 text-sm">Unsaved content<input id="file-draft" defaultValue="Draft stays here" className="rounded-md border p-2" /></label>
      <pre className="min-h-0 flex-1 overflow-auto rounded-lg bg-muted p-4 text-xs">{"workspace/\n  src/\n    app.tsx\n    theme.css\n  README.md"}</pre>
    </div> },
    { id: "Computer", label: "Computer", icon: <MonitorIcon />, content: <Computer /> },
    { id: "Whiteboard", label: "Whiteboard", icon: <PresentationIcon />, content: <div data-view="Whiteboard" className="flex h-full items-center justify-center bg-background p-5">
      <div className="rounded-xl border-2 border-dashed p-8 text-center"><PresentationIcon className="mx-auto mb-3 size-10" />A separate live canvas</div>
    </div> },
  ], [])

  const run = async () => {
    setRunning(true)
    setResult("Running…")
    try {
      check(initialTransitionCount === 0, "Initial content must not play a page transition")
      setActive("Tasks")
      await until(() => visibleView("Tasks"), "Tasks did not become visible")
      await wait(550)
      const bar = document.querySelector<HTMLElement>('[role="tablist"]')!
      const original = bar.getBoundingClientRect()
      const select = async (id: string) => {
        const count = nativeTransitions.length
        pointerSelect(id)
        await until(() => visibleView(id), `${id} did not become visible`)
        const transition = nativeTransitions[count]
        if (transition) await transition.ready
        return transition
      }
      const first = await select("Files")
      const file = document.querySelector<HTMLInputElement>("#file-draft")!
      file.value = "Unsaved zoom fixture content"
      if (first) {
        const animations = pageAnimations()
        check(animations.length >= 2, "Old and new content snapshots must both animate")
        const frames = animations.flatMap((animation) => (animation.effect as KeyframeEffect).getKeyframes())
        if (reducedMotion) {
          check(frames.every((frame) => !frame.transform || frame.transform === "none"), "Reduced motion must fade without scaling")
        } else {
          check(frames.some((frame) => String(frame.transform).includes("0.94")), "Incoming content must use the reference zoom scale")
          check(frames.some((frame) => String(frame.transform).includes("1.04")), "Outgoing content must grow away")
        }
        const panel = document.querySelector<HTMLElement>('[data-slot="page-transition"]')!
        const name = document.documentElement.getAttribute("data-page-transition")!
        const pair = getComputedStyle(document.documentElement, `::view-transition-image-pair(${name})`)
        check(pair.borderRadius === getComputedStyle(panel).borderRadius, "The animated snapshots must retain the content viewport's corner radius")
        check(pair.overflowX === "clip" || pair.overflowX === "hidden", "The snapshot pair must clip zoomed content")
        check(!getComputedStyle(bar).viewTransitionName || getComputedStyle(bar).viewTransitionName === "none", "The tab bar must stay outside the named transition")
      }
      await first?.finished
      const desktop = await select("Computer")
      check(computer.mounted > computer.unmounted, "Computer should mount while selected")
      check(file.isConnected && file.getBoundingClientRect().height === 0, "Files must remain mounted and hidden")
      check(file.closest('[inert][aria-hidden="true"]'), "Hidden files must not receive focus or appear to assistive technology")
      await desktop?.finished
      const unmounted = computer.unmounted
      const board = await select("Whiteboard")
      check(!document.querySelector('[data-view="Computer"]'), "The outgoing computer must leave the live DOM immediately")
      check(computer.unmounted === unmounted + 1, "Computer must release its connection before the outgoing animation finishes")
      if (board && !reducedMotion) check(pageAnimations().some((animation) => animation.playState === "running"), "Computer teardown must occur while snapshots are still animating")
      await board?.finished
      await (await select("Files"))?.finished
      check(document.querySelector("#file-draft") === file && file.value === "Unsaved zoom fixture content", "Returning to Files must preserve the exact editor node and unsaved value")

      pointerSelect("Tasks")
      await wait(25)
      pointerSelect("Computer")
      await wait(25)
      pointerSelect("Whiteboard")
      await until(() => visibleView("Whiteboard"), "Rapid switching did not settle on the latest tab")
      await wait(650)
      check(tab("Whiteboard").getAttribute("aria-selected") === "true", "Rapid switching must retain the latest selection")
      check(computer.mounted === computer.unmounted, "Rapid switching must not leave a hidden desktop connected")
      check(!document.querySelector('[data-view="Computer"]'), "Rapid switching left an obsolete live panel")

      // Flush two distinct React commits before the browser captures either new
      // snapshot: the cancelled intermediate update must never replace A.
      flushSync(() => pointerSelect("Tasks"))
      flushSync(() => pointerSelect("Whiteboard"))
      await wait(650)
      check(visibleView("Whiteboard") && !visibleView("Tasks"), "A→B→A before snapshot must retain the final A")
      check(!document.documentElement.hasAttribute("data-page-transition"), "Cancelled transitions must clean up their document scope")

      const beforeKeyboard = nativeTransitions.length
      const tasks = tab("Tasks")
      tasks.focus()
      tasks.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      tasks.click()
      await until(() => visibleView("Tasks"), "Keyboard selection did not reveal its content")
      check(nativeTransitions.length === beforeKeyboard, "Keyboard selection must update immediately without a native snapshot")
      check(document.activeElement === tasks, "Keyboard selection must preserve focus on its tab")
      const bounds = bar.getBoundingClientRect()
      check(Math.abs(bounds.y - original.y) < 1 && Math.abs(bounds.height - original.height) < 1, "Panel zoom must not move or resize the tab bar")
      const panel = document.querySelector<HTMLElement>('[data-slot="page-transition"]')!
      check(panel && panel.scrollWidth <= panel.clientWidth && panel.scrollHeight <= panel.clientHeight, "The content viewport must not overflow after zoom")
      check(document.documentElement.scrollWidth <= innerWidth, "The fixture must fit the viewport")
      setResult(`PASS: zoom snapshots, retained file draft, immediate desktop teardown, rapid switching, keyboard selection, stable tab bar and clipping. ${reducedMotion ? "Reduced motion fade." : document.startViewTransition ? "Native view transitions." : "Browser without view transitions: lifecycle only."}`)
    } catch (error) {
      setResult(`FAIL: ${error instanceof Error ? error.stack : String(error)}`)
    } finally { setRunning(false) }
  }
  return <main className="min-h-screen bg-background p-4 text-foreground">
    <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
      <button id="run-checks" disabled={running} onClick={() => void run()} className="rounded-md border px-3 py-2 disabled:opacity-50">Run workspace tab checks</button>
      <button onClick={() => setNarrow((value) => !value)} className="rounded-md border px-3 py-2">{narrow ? "Wide" : "Narrow"}</button>
      <span>{reducedMotion ? "Reduced motion" : "Zoom motion"}</span>
    </div>
    <pre id="results" role="status" className="mb-4 whitespace-pre-wrap text-sm">{result}</pre>
    <div id="workspace-fixture" className="h-[480px] max-w-full rounded-[26px] border" style={{ width: narrow ? 350 : 640 }}>
      <ExpandableTabs items={items} value={active} onValueChange={setActive} ariaLabel="Workspace modules" />
    </div>
  </main>
}

createRoot(document.getElementById("root")!).render(<MotionConfig reducedMotion={reducedMotion ? "always" : "user"}>
  <TooltipProvider><Fixture /></TooltipProvider>
</MotionConfig>)
