import { useState } from "react"
import { createRoot } from "react-dom/client"
import { WhiteboardCanvas } from "../../../src/features/whiteboard/whiteboard-renderer"
import { TooltipProvider } from "../../../src/components/ui/tooltip"
import { applyBoardChange, createdElementCues, type AnimationCue, type BoardOperation } from "../../../src/features/whiteboard/whiteboard-model"
import { fixtureBoard } from "./whiteboard-fixture"
import i18n from "../../../src/i18n"
import "../../../src/index.css"
const params = new URLSearchParams(location.search)
await i18n.changeLanguage(params.has("en") ? "en" : "zh-CN")
document.documentElement.classList.toggle("dark", params.has("dark"))
const host = document.querySelector<HTMLDivElement>("#page")!
if (params.has("narrow")) host.style.width = "390px"
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
function waitForDOM(condition: () => boolean, message: string, timeout = 1500) {
  const deadline = performance.now() + timeout
  return new Promise<void>((resolve, reject) => {
    const inspect = () => {
      if (condition()) resolve()
      else if (performance.now() >= deadline) reject(new Error(message))
      else requestAnimationFrame(inspect)
    }
    requestAnimationFrame(inspect)
  })
}
let stream = () => {}
let resetFixture = () => {}
let replayForChecks = async () => {}
let current = fixtureBoard
const edits: BoardOperation[][] = []
const timers = new Set<ReturnType<typeof setTimeout>>()
function clearTimers() { timers.forEach(clearTimeout); timers.clear() }
export function App() {
  const [board, setBoard] = useState(fixtureBoard)
  const [cues, setCues] = useState<Record<string, AnimationCue>>({})
  current = board
  function commit(ops: BoardOperation[], source: "agent" | "user") {
    const revision = current.revision + 1
    const nextCues = createdElementCues(current, ops, revision, source)
    current = applyBoardChange(current, revision, ops, fixtureBoard.title)
    setCues(previous => ({ ...previous, ...nextCues }))
    setBoard(current)
  }
  resetFixture = () => {
    clearTimers()
    edits.length = 0
    current = fixtureBoard
    setCues({}); setBoard(current)
  }
  stream = () => {
    clearTimers()
    current = { ...fixtureBoard, revision: 0, order: [], elements: {} }
    setCues({}); setBoard(current)
    fixtureBoard.order.forEach((id, index) => {
      const timer = setTimeout(() => {
        timers.delete(timer)
        commit([{ op: "set", id, element: fixtureBoard.elements[id] }], "agent")
      }, index * 100 + 100)
      timers.add(timer)
    })
  }
  replayForChecks = async () => {
    const ids = ["underline", "select"]
    setCues({})
    commit(ids.map(id => ({ op: "delete", id })), "user")
    await nextFrame()
    commit(ids.map(id => ({ op: "set", id, element: fixtureBoard.elements[id] })), "agent")
    await nextFrame()
  }
  return <TooltipProvider><WhiteboardCanvas board={board} cues={cues} onWrite={ops => { edits.push(ops); commit(ops, "user") }} /></TooltipProvider>
}
createRoot(host).render(<App />)
document.querySelector("#stream")!.addEventListener("click", () => stream())
document.querySelector("#narrow")!.addEventListener("click", () => { host.style.width = host.style.width ? "" : "390px" })
document.querySelector("#checks")!.addEventListener("click", async () => {
  const output = document.querySelector("#results")!
  const button = document.querySelector<HTMLButtonElement>("#checks")!
  button.disabled = true
  let count = 0
  try {
    const check = (condition: unknown, text: string) => { if (!condition) throw new Error(text); count++ }
    const checkLabelCoverage = () => {
      for (const label of document.querySelectorAll<HTMLElement>(".wb-arrow-label-content")) {
        const rect = label.getBoundingClientRect()
        const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        check(top && label.contains(top), "Connection line is painted above its opaque label")
      }
    }
    resetFixture()
    await waitForDOM(() => document.querySelectorAll(".react-flow__edge-path").length === 3 && document.querySelectorAll(".wb-cap").length === 3, "React Flow did not finish measuring the restored board")
    check(document.querySelectorAll(".wb-cap").length === 3, "Database and queue ellipse edges missing")
    check(document.querySelectorAll(".react-flow__edge").length === 3, "Flow and return arrows missing")
    checkLabelCoverage()
    const frame = document.querySelector("iframe")!
    check(frame.getAttribute("sandbox") === "allow-scripts", "Embedded app is not isolated")
    for (const id of ["underline", "return-circle", "stroke"]) {
      const path = document.querySelector<SVGPathElement>(`[data-id="${id}"] path.wb-stroke`)!
      check(path && /[CQ]/i.test(path.getAttribute("d") ?? ""), `${id} is rendered as angular line segments instead of a smooth stroke`)
    }
    const returnPath = document.querySelector<SVGPathElement>('.react-flow__edge[data-id="return"] .react-flow__edge-path')!
    const bounds = returnPath.getBBox()
    const start = returnPath.getPointAtLength(0), end = returnPath.getPointAtLength(returnPath.getTotalLength())
    check(bounds.width > 450 && bounds.height > 40 && returnPath.getTotalLength() > Math.hypot(end.x - start.x, end.y - start.y) + 70, "Realtime return arrow lost its U route")
    check(returnPath.getAttribute("d")?.match(/M/g)?.length === 1, "Return arrow restarts drawing at its bends")
    check(document.querySelector('[data-id="queue-label"]')?.textContent?.includes("队列"), "Shape gallery is missing its original Chinese labels")
    const input = document.querySelector<HTMLInputElement>(".wb-table tbody input")!
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Updated")
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await nextFrame()
    input.blur()
    await nextFrame()
    check(edits.length > 0, "Table edit was not submitted")
    check(current.elements.table.type === "table" && current.elements.table.rows[0][0] === "Updated", "Table edit did not persist")
    check([...document.querySelectorAll(".wb-cap")].every(path => getComputedStyle(path).opacity === "1"), "Ellipse cap disappears after drawing")
    const browser = document.querySelector<HTMLElement>('.react-flow__node[data-id="browser"]')!
    const oldX = current.elements.browser.type === "shape" ? current.elements.browser.x : NaN
    browser.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await nextFrame()
    browser.focus()
    browser.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
    await nextFrame()
    check(current.elements.browser.type === "shape" && current.elements.browser.x === oldX + 5, "Keyboard movement did not persist")
    checkLabelCoverage()
    await replayForChecks()
    await waitForDOM(() => !!document.querySelector('[data-id="underline"] path.wb-stroke') && !!document.querySelector('.react-flow__edge[data-id="select"] .react-flow__edge-path'), "New Agent elements did not render")
    for (const selector of ['[data-id="underline"] path.wb-stroke', '.react-flow__edge[data-id="select"] .react-flow__edge-path']) {
      const path = document.querySelector<SVGPathElement>(selector)!
      const trace = path.getAnimations().find(animation => animation.effect instanceof KeyframeEffect && animation.effect.getKeyframes().some(keyframe => "strokeDashoffset" in keyframe))
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        check(!trace && Math.abs(Number.parseFloat(getComputedStyle(path).strokeDashoffset)) < .01, "Reduced motion still animates or hides path drawing")
        if (selector.includes("select")) {
          const edge = path.closest(".react-flow__edge")!
          const head = edge.querySelector<SVGPathElement>(".wb-arrow-head")!
          const pen = edge.querySelector<SVGCircleElement>(".wb-pen")!
          const label = [...document.querySelectorAll<HTMLElement>(".wb-arrow-label-content")].find(element => element.textContent === "选区")!
          check(getComputedStyle(head).opacity === "1" && getComputedStyle(label).opacity === "1" && getComputedStyle(pen).opacity === "0", "Reduced motion has a hidden head/label or visible drawing pen")
        }
        continue
      }
      check(trace, `${selector} has no actual path tracing animation`)
      trace!.pause()
      const timing = trace!.effect!.getTiming()
      const duration = Number(timing.duration), delay = Number(timing.delay)
      trace!.currentTime = delay
      await nextFrame()
      const startOffset = Number.parseFloat(getComputedStyle(path).strokeDashoffset)
      trace!.currentTime = delay + duration * .25
      await nextFrame()
      const middleOffset = Number.parseFloat(getComputedStyle(path).strokeDashoffset)
      trace!.currentTime = delay + duration
      await nextFrame()
      const endOffset = Number.parseFloat(getComputedStyle(path).strokeDashoffset)
      check(startOffset > .95 && middleOffset > 0 && middleOffset < startOffset, `${selector} does not reveal its path progressively`)
      check(Math.abs(endOffset) < .01, `${selector} is not fully drawn at completion`)
      trace!.finish()
      if (selector.includes("select")) {
        const edge = path.closest(".react-flow__edge")!
        const head = edge.querySelector<SVGPathElement>(".wb-arrow-head")!
        const pen = edge.querySelector<SVGCircleElement>(".wb-pen")!
        const label = [...document.querySelectorAll<HTMLElement>(".wb-arrow-label-content")].find(element => element.textContent === "选区")!
        const headAnimation = head.getAnimations()[0]
        const labelAnimation = label.getAnimations()[0]
        const penAnimation = pen.getAnimations()[0]
        check(headAnimation && Number(headAnimation.effect!.getTiming().delay) >= delay + duration * .75, "Arrow head appears before its line reaches the end")
        headAnimation.pause(); headAnimation.currentTime = delay
        await nextFrame()
        const headStart = Number.parseFloat(getComputedStyle(head).opacity)
        headAnimation.finish()
        await nextFrame()
        check(headStart === 0 && Number.parseFloat(getComputedStyle(head).opacity) === 1, "Arrow head does not fade in at the end of drawing")
        check(labelAnimation && Number(labelAnimation.effect!.getTiming().delay) >= delay + duration * .5, "Arrow label appears before the line is established")
        labelAnimation.pause(); labelAnimation.currentTime = delay
        await nextFrame()
        const labelStart = Number.parseFloat(getComputedStyle(label).opacity)
        labelAnimation.finish()
        await nextFrame()
        check(labelStart === 0 && Number.parseFloat(getComputedStyle(label).opacity) === 1 && label.parentElement!.style.transform.includes("translate"), "Arrow label loses its positioned entrance")
        const expectedPath = document.createElement("span")
        expectedPath.style.offsetPath = `path("${path.getAttribute("d")}")`
        check(penAnimation && pen.style.offsetPath === expectedPath.style.offsetPath, "Drawing pen does not follow the actual connector path")
        penAnimation.pause(); penAnimation.currentTime = delay + duration * .2
        await nextFrame()
        const penMiddle = Number.parseFloat(getComputedStyle(pen).offsetDistance)
        const penOpacity = Number.parseFloat(getComputedStyle(pen).opacity)
        penAnimation.finish()
        await nextFrame()
        check(penMiddle > 0 && penMiddle < 100 && penOpacity > 0 && Number.parseFloat(getComputedStyle(pen).opacity) === 0, "Drawing pen does not travel and disappear at completion")
      }
    }
    output.textContent = `PASS ${count} whiteboard checks`
  } catch (error) { output.textContent = `FAIL: ${error instanceof Error ? error.message : error}` }
  finally { button.disabled = false }
})
