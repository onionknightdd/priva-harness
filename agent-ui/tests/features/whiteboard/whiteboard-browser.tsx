import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import { WhiteboardCanvas } from "../../../src/features/whiteboard/whiteboard-renderer"
import { TooltipProvider } from "../../../src/components/ui/tooltip"
import { applyBoardChange, createdElementCues, type AnimationCue, type Board, type BoardOperation } from "../../../src/features/whiteboard/whiteboard-model"
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
let replayPresence = async (_delay = 1000) => {}
let deleteForChecks = (_id: string) => {}
let appendRowsForChecks = () => {}
let replayNarrowPerson = async () => {}
let replaceBrowserCue = (_delay: number) => {}
let current = fixtureBoard
let fileMenuRefreshes = 0
const sessionFiles = [
  { name: "whiteboard-demo.board.json", path: "/workspace/.whiteboard/fixture-session/whiteboard-demo.board.json" },
  { name: "planning-notes.board.json", path: "/workspace/.whiteboard/fixture-session/nested/planning-notes.board.json" },
]
const secondBoard: Board = { v: 1, title: "仅供内容切换验证的白板标题", revision: 1, order: ["second-board-note"], elements: {
  "second-board-note": { type: "shape", kind: "rounded", x: 80, y: 80, w: 320, h: 120, text: "当前 session 的第二份白板", color: "green" },
} }
const edits: BoardOperation[][] = []
const timers = new Set<ReturnType<typeof setTimeout>>()
function clearTimers() { timers.forEach(clearTimeout); timers.clear() }
function drawingAnimations() {
  return [...new Set([...document.querySelectorAll(".wb-drawing, .wb-arrow-label-drawing")].flatMap(element => element.getAnimations({ subtree: true })))].filter(animation => animation instanceof CSSAnimation && animation.animationName.startsWith("wb-"))
}
function drawingFrame(id: string) { return document.querySelector<HTMLElement>(`.wb-drawing-frame[data-element-id="${id}"]`) }
const presenceIds = ["browser", "return", "vote", "table", "stroke"]
export function App() {
  const [board, setBoard] = useState(fixtureBoard)
  const [selectedPath, setSelectedPath] = useState(sessionFiles[0].path)
  const [cues, setCues] = useState<Record<string, AnimationCue>>({})
  current = board
  function commit(ops: BoardOperation[], source: "agent" | "user") {
    const revision = current.revision + 1
    const nextCues = createdElementCues(current, ops, revision, source)
    current = applyBoardChange(current, revision, ops, fixtureBoard.title)
    setCues(previous => Object.fromEntries(Object.entries({ ...previous, ...nextCues }).filter(([id]) => Object.hasOwn(current.elements, id))))
    setBoard(current)
  }
  resetFixture = () => {
    clearTimers()
    edits.length = 0
    fileMenuRefreshes = 0
    current = fixtureBoard
    setSelectedPath(sessionFiles[0].path)
    setCues({}); setBoard(current)
  }
  stream = () => {
    clearTimers()
    setSelectedPath(sessionFiles[0].path)
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
  replayPresence = async (delay = 1000) => {
    clearTimers()
    setSelectedPath(sessionFiles[0].path)
    setCues({})
    await nextFrame()
    const table = fixtureBoard.elements.table
    if (table.type !== "table") throw new Error("Missing table fixture")
    current = { ...fixtureBoard, revision: current.revision + 1, elements: { ...fixtureBoard.elements, table: { ...table, rows: Array.from({ length: 14 }, (_, row) => [`Row ${row + 1}`, "逐行出现", "sm"]) } } }
    setBoard(current)
    setCues(Object.fromEntries(presenceIds.map(id => [id, { revision: current.revision, delay }])))
    await waitForDOM(() => matchMedia("(prefers-reduced-motion: reduce)").matches ? document.querySelectorAll(".wb-table tbody tr").length === 14 : presenceIds.every(id => document.querySelector(`[data-id="${id}"] .wb-drawing`)), "Presence replay did not mount all animated elements")
    drawingAnimations().forEach(animation => { animation.pause(); animation.currentTime = 0 })
    await nextFrame()
  }
  deleteForChecks = id => commit([{ op: "delete", id }], "user")
  appendRowsForChecks = () => {
    const table = current.elements.table
    if (table.type !== "table") throw new Error("Missing table fixture")
    commit([{ op: "update", id: "table", patch: { rows: [...table.rows, ["Appended 1", "增量出现", "sm"], ["Appended 2", "增量出现", "sm"]] } }], "agent")
  }
  replayNarrowPerson = async () => {
    setCues({})
    await nextFrame()
    commit([{ op: "update", id: "person", patch: { w: 32, h: 200 } }], "user")
    setCues({ person: { revision: current.revision, delay: 1000 } })
    await waitForDOM(() => !!document.querySelector('[data-id="person"] .wb-drawing'), "Narrow person replay did not mount")
    drawingAnimations().forEach(animation => { animation.pause(); animation.currentTime = 1100 })
    await waitForDOM(() => !!drawingFrame("person"), "Narrow person drawing did not show its frame")
  }
  replaceBrowserCue = delay => {
    current = { ...current, revision: current.revision + 1 }
    setBoard(current)
    setCues(previous => ({ ...previous, browser: { revision: current.revision, delay } }))
  }
  return <TooltipProvider><WhiteboardCanvas key={selectedPath} board={board} path={selectedPath} filePicker={{ files: sessionFiles, loading: false, error: null,
    onRefresh() { fileMenuRefreshes++ },
    onSelect(path) {
      clearTimers()
      current = path === sessionFiles[0].path ? fixtureBoard : secondBoard
      setSelectedPath(path); setBoard(current); setCues({})
    },
  }} cues={cues} onDrawingComplete={(id, revision) => setCues(previous => {
    if (previous[id]?.revision !== revision) return previous
    const next = { ...previous }; delete next[id]; return next
  })} onWrite={ops => { edits.push(ops); commit(ops, "user") }} /></TooltipProvider>
}
createRoot(host).render(<StrictMode><App /></StrictMode>)
document.querySelector("#stream")!.addEventListener("click", () => stream())
document.querySelector("#narrow")!.addEventListener("click", () => { host.style.width = host.style.width ? "" : "390px" })
document.querySelector("#preview")!.addEventListener("click", async () => {
  const output = document.querySelector("#results")!
  try {
    await replayPresence()
    drawingAnimations().forEach(animation => { animation.currentTime = 1200 })
    await nextFrame()
    output.textContent = matchMedia("(prefers-reduced-motion: reduce)").matches ? "Reduced motion: complete drawing, no presence frames" : "Paused mid-drawing; Stream Agent drawing resumes the live demo"
  } catch (error) { output.textContent = `FAIL: ${error instanceof Error ? error.message : error}` }
})
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
    const fileTrigger = () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.getAttribute("aria-label") === i18n.t("whiteboard.switchFile"))!
    const menuRadios = () => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
    check(fileTrigger().textContent?.trim() === "whiteboard-demo.board" && !fileTrigger().textContent?.includes("/"), "File picker must show the filename without its trailing .json")
    const refreshCount = fileMenuRefreshes
    fileTrigger().click()
    await waitForDOM(() => fileTrigger().getAttribute("aria-expanded") === "true" && menuRadios().length === 2, "Session file menu did not open")
    check(fileMenuRefreshes === refreshCount + 1, "Opening the file picker did not refresh the session file list")
    check(menuRadios().every((item, index) => item.textContent?.trim() === ["whiteboard-demo.board", "planning-notes.board"][index] && !item.textContent.includes("/")), "Session file choices must show filenames without trailing .json or directory paths")
    check(menuRadios()[0].getAttribute("aria-checked") === "true" && menuRadios()[1].getAttribute("aria-checked") === "false", "File picker does not mark the currently open file")
    menuRadios()[1].click()
    await waitForDOM(() => fileTrigger().textContent?.trim() === "planning-notes.board" && !!host.querySelector('[data-id="second-board-note"]') && !host.querySelector('[data-id="browser"]'), "Selecting the second session file did not switch the filename and canvas content")
    check(!host.textContent?.includes(secondBoard.title), "The board title is displayed instead of the selected filename")
    const secondRefreshCount = fileMenuRefreshes
    fileTrigger().click()
    await waitForDOM(() => menuRadios().length === 2 && fileTrigger().getAttribute("aria-expanded") === "true", "File picker did not reopen on the second whiteboard")
    check(fileMenuRefreshes === secondRefreshCount + 1 && menuRadios()[1].getAttribute("aria-checked") === "true", "Reopened picker did not refresh or mark the second file")
    menuRadios()[0].click()
    await waitForDOM(() => fileTrigger().textContent?.trim() === "whiteboard-demo.board" && document.querySelectorAll(".react-flow__edge-path").length === 3 && !host.querySelector('[data-id="second-board-note"]'), "Switching back did not restore the original whiteboard content")
    check(current === fixtureBoard, "Switching files did not restore the intended document")
    const deleteButton = [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.getAttribute("aria-label") === i18n.t("whiteboard.delete"))!
    const downloadButton = [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.getAttribute("aria-label") === i18n.t("whiteboard.download"))!
    await waitForDOM(() => !downloadButton.disabled, "Download did not become available after the selected whiteboard initialized")
    const deleteRect = deleteButton.getBoundingClientRect(), downloadRect = downloadButton.getBoundingClientRect()
    check(deleteButton.closest(".wb-toolbar") === downloadButton.closest(".wb-toolbar") && downloadRect.left >= deleteRect.right && Math.abs(downloadRect.top - deleteRect.top) < 2, "Download is not positioned to the right of delete")
    downloadButton.click()
    await waitForDOM(() => downloadButton.getAttribute("aria-expanded") === "true" && document.querySelectorAll('[role="menuitem"]').length >= 2, "Download format menu did not open")
    const downloadItems = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    check(downloadItems.some(item => item.textContent === i18n.t("whiteboard.downloadPng")) && downloadItems.some(item => item.textContent === i18n.t("whiteboard.downloadPdf")), "Download menu does not offer both PNG and PDF")
    downloadButton.click()
    await waitForDOM(() => downloadButton.getAttribute("aria-expanded") !== "true", "Download menu did not close without starting an export")
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
    const pathAnimations = drawingAnimations()
    pathAnimations.forEach(animation => animation.pause())
    await Promise.all(pathAnimations.map(animation => animation.ready))
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) check(pathAnimations.length > 0 && pathAnimations.every(animation => Math.abs(animation.playbackRate - 2 / 3) < .001), "Drawing animations do not share the slower playback rate")
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
          check(getComputedStyle(head).opacity === "1" && getComputedStyle(label).opacity === "1" && (!pen || getComputedStyle(pen).opacity === "0"), "Reduced motion has a hidden head/label or visible drawing pen")
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
        check(penMiddle > 0 && penMiddle < 100 && penOpacity > 0 && (!pen.isConnected || Number.parseFloat(getComputedStyle(pen).opacity) === 0), "Drawing pen does not travel and disappear at completion")
      }
    }
    pathAnimations.forEach(animation => { if (animation.playState !== "idle") animation.finish() })
    await waitForDOM(() => !document.querySelector(".wb-drawing-frame"), "Completed drawing left a presence frame")
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      await replayPresence()
      check(!document.querySelector(".wb-drawing-frame") && !drawingAnimations().length, "Reduced motion shows a presence frame or pending drawing animation")
      check(document.querySelector(".wb-status")?.getAttribute("data-drawing") === "false", "Reduced motion leaves the drawing status active")
    } else {
      await replayPresence()
      const presenceAnimations = drawingAnimations()
      check(presenceAnimations.length > 14, "Presence fixture is missing staggered table rows")
      check(!document.querySelector(".wb-drawing-frame"), "Queued elements show presence frames before their animations start")
      presenceAnimations.forEach(animation => { animation.currentTime = 1001 })
      await waitForDOM(() => presenceIds.every(id => drawingFrame(id)), "Started drawing did not show per-element presence frames")
      for (const id of presenceIds) {
        const outline = drawingFrame(id)!
        const style = getComputedStyle(outline)
        const tab = outline.querySelector<HTMLElement>(".wb-drawing-tab")!
        check(style.borderStyle === "dashed" && style.borderTopColor === "rgb(96, 165, 250)", `${id} lost its light blue dashed border`)
        check(style.backgroundColor === "rgba(96, 165, 250, 0.06)", `${id} has no pale blue fill`)
        const tabShape = tab?.querySelector("svg")
        check(tab?.textContent === "Bambuddy" && tabShape && getComputedStyle(tabShape).fill === "rgb(96, 165, 250)", `${id} lost the light blue Bambuddy tab`)
        check(getComputedStyle(tab).color === (params.has("dark") ? "rgb(7, 30, 64)" : "rgb(255, 255, 255)"), `${id} has the wrong Bambuddy text color for its theme`)
        check(style.pointerEvents === "none" && outline.getAttribute("aria-hidden") === "true", `${id} presence intercepts input or accessibility navigation`)
        const rect = outline.getBoundingClientRect(), tabRect = tab.getBoundingClientRect()
        check(tabRect.top < rect.top && Math.abs(tabRect.left - rect.left) < 4, `${id} tab is not attached to the upper-left border`)
      }
      const contains = (outer: DOMRect, inner: DOMRect) => outer.left <= inner.left + 1 && outer.top <= inner.top + 1 && outer.right >= inner.right - 1 && outer.bottom >= inner.bottom - 1
      const returnFrame = drawingFrame("return")!.getBoundingClientRect()
      const returnLine = document.querySelector<SVGPathElement>('.react-flow__edge[data-id="return"] .react-flow__edge-path')!
      const returnLabel = [...document.querySelectorAll<HTMLElement>(".wb-arrow-label")].find(element => element.textContent === "实时推送")!
      check(contains(returnFrame, returnLine.getBoundingClientRect()), "Return connector bends escape its presence frame")
      check(contains(returnFrame, returnLabel.getBoundingClientRect()), "Return connector label escapes its presence frame")
      for (const id of ["vote", "table"]) {
        const outline = drawingFrame(id)!
        const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!
        check(contains(outline.getBoundingClientRect(), node.getBoundingClientRect()) && !outline.closest(".wb-html, .wb-table"), `${id} clips its presence frame`)
      }
      checkLabelCoverage()
      const beforeZoom = drawingFrame("browser")!.getBoundingClientRect()
      const zoomIn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.getAttribute("aria-label") === i18n.t("whiteboard.zoomIn"))!
      zoomIn.click()
      await waitForDOM(() => drawingFrame("browser")!.getBoundingClientRect().width > beforeZoom.width + 1, "Zoom did not scale the presence frame")
      const browserNode = document.querySelector<HTMLElement>('.react-flow__node[data-id="browser"]')!
      check(contains(drawingFrame("browser")!.getBoundingClientRect(), browserNode.getBoundingClientRect()), "Zoom moves the frame away from its element")
      const beforePan = drawingFrame("browser")!.getBoundingClientRect()
      const pane = document.querySelector<HTMLElement>(".react-flow__pane")!
      const paneRect = pane.getBoundingClientRect()
      pane.dispatchEvent(new WheelEvent("wheel", { deltaX: 80, deltaY: 40, bubbles: true, cancelable: true, clientX: paneRect.x + paneRect.width / 2, clientY: paneRect.y + paneRect.height / 2 }))
      await waitForDOM(() => Math.abs(drawingFrame("browser")!.getBoundingClientRect().x - beforePan.x) > 1, "Pan did not move the presence frame")
      check(contains(drawingFrame("browser")!.getBoundingClientRect(), browserNode.getBoundingClientRect()), "Pan moves the frame away from its element")
      const lastRow = document.querySelector(".wb-table tbody tr:last-child")!
      const lastRowAnimation = presenceAnimations.find(animation => animation.effect instanceof KeyframeEffect && animation.effect.target === lastRow)!
      const rowTiming = lastRowAnimation.effect!.getTiming()
      lastRowAnimation.currentTime = Number(rowTiming.delay) + Number(rowTiming.duration) * .5
      presenceAnimations.filter(animation => animation !== lastRowAnimation).forEach(animation => animation.finish())
      await nextFrame()
      check(Number(lastRowAnimation.currentTime) > 1900 && !!drawingFrame("table"), "Long table presence ends before its final row finishes")
      check(document.querySelectorAll(".wb-drawing-frame").length === 1 && document.querySelector(".wb-status")?.getAttribute("data-drawing") === "true", "Finished elements or toolbar do not follow individual animation completion")
      appendRowsForChecks()
      await waitForDOM(() => document.querySelectorAll(".wb-table tbody tr").length === 16, "Incremental rows did not render during the existing drawing cue")
      const appendedRows = [...document.querySelectorAll(".wb-table tbody tr")].slice(14)
      const appendedAnimations = drawingAnimations().filter(animation => animation.effect instanceof KeyframeEffect && appendedRows.includes(animation.effect.target as Element))
      check(appendedAnimations.length === 2, "Incremental rows did not join the current cue's animation lifecycle")
      appendedAnimations.forEach(animation => { animation.pause(); animation.currentTime = 0 })
      lastRowAnimation.finish()
      await nextFrame()
      check(!!drawingFrame("table") && document.querySelector(".wb-status")?.getAttribute("data-drawing") === "true", "Finishing the old rows cleared the same cue while appended rows were still pending")
      appendedAnimations.forEach(animation => animation.finish())
      await waitForDOM(() => !document.querySelector(".wb-drawing-frame") && document.querySelector(".wb-status")?.getAttribute("data-drawing") === "false", "Final appended row did not clear frame and drawing status")
      check(true, "All completed frames and drawing status are cleared")

      await replayPresence()
      const cancelledAnimations = drawingAnimations()
      cancelledAnimations.forEach(animation => { animation.currentTime = 1100 })
      await waitForDOM(() => !!drawingFrame("vote"), "Cancellation fixture did not start")
      deleteForChecks("vote")
      await waitForDOM(() => !drawingFrame("vote") && !document.querySelector('.react-flow__node[data-id="vote"]'), "Deleting an element left its presence frame")
      check(true, "Deleted element frame is removed")
      cancelledAnimations.forEach(animation => animation.cancel())
      await waitForDOM(() => !document.querySelector(".wb-drawing-frame"), "Cancelled animations left presence frames")
      check(true, "Cancelled animation frames are removed")

      await replayNarrowPerson()
      const personPath = document.querySelector<SVGPathElement>('[data-id="person"] .wb-outline')!
      const personNode = document.querySelector<HTMLElement>('.react-flow__node[data-id="person"]')!
      check(personPath.getBBox().width > 32 && personPath.getBoundingClientRect().width > personNode.getBoundingClientRect().width, "Narrow person fixture does not exercise geometry outside its node box")
      check(contains(drawingFrame("person")!.getBoundingClientRect(), personPath.getBoundingClientRect()), "Narrow person's head escapes its drawing frame")
      drawingAnimations().forEach(animation => animation.finish())
      await waitForDOM(() => !drawingFrame("person"), "Completed narrow person left its drawing frame")

      await replayPresence()
      drawingAnimations().forEach(animation => { animation.currentTime = 1100 })
      await waitForDOM(() => !!drawingFrame("browser"), "Cue replacement fixture did not start")
      const retainedNode = document.querySelector<HTMLElement>('.react-flow__node[data-id="browser"]')!
      replaceBrowserCue(2000)
      await waitForDOM(() => retainedNode.querySelector<HTMLElement>(".wb-element")?.style.getPropertyValue("--wb-delay") === "2000ms", "New cue was not applied to the existing element")
      const restartedAnimations = retainedNode.getAnimations({ subtree: true })
      check(restartedAnimations.length > 0 && restartedAnimations.every(animation => Number(animation.currentTime) < 1000), "Replacing the cue did not restart existing CSS animations")
      restartedAnimations.forEach(animation => { animation.pause(); animation.currentTime = 0 })
      await nextFrame()
      check(!drawingFrame("browser") && document.querySelector('.react-flow__node[data-id="browser"]') === retainedNode, "Replacing the cue recreated its node or kept the old frame during the new delay")
      restartedAnimations.forEach(animation => { animation.currentTime = 2100 })
      await waitForDOM(() => !!drawingFrame("browser"), "Replacement cue did not show a frame when its restarted drawing began")
      check(true, "Replacement cue begins a fresh drawing lifetime")
      // Resolve the old cue's promises in the same task that queues a newer cue.
      restartedAnimations.forEach(animation => animation.finish())
      replaceBrowserCue(3000)
      await waitForDOM(() => retainedNode.querySelector<HTMLElement>(".wb-element")?.style.getPropertyValue("--wb-delay") === "3000ms", "Newest cue was not applied after the old cue finished")
      const newestAnimations = retainedNode.getAnimations({ subtree: true })
      newestAnimations.forEach(animation => { animation.pause(); animation.currentTime = 0 })
      await nextFrame()
      check(newestAnimations.length > 0 && !!retainedNode.querySelector(".wb-drawing") && !drawingFrame("browser"), "An older completion cleared the replacement cue or its queued frame")
      newestAnimations.forEach(animation => { animation.currentTime = 3100 })
      await waitForDOM(() => !!drawingFrame("browser"), "Newest cue was removed by an older completion")
      drawingAnimations().forEach(animation => animation.finish())
      await waitForDOM(() => !document.querySelector(".wb-drawing-frame"), "Replaced cue did not clean up after its own completion")
      check(true, "Only the matching cue completion clears its frame")

      await replayPresence()
      drawingAnimations().forEach(animation => { animation.currentTime = 1100 })
      await waitForDOM(() => !!drawingFrame("browser"), "Reset fixture did not start")
      resetFixture()
      await waitForDOM(() => !document.querySelector(".wb-drawing-frame") && !document.querySelector(".wb-drawing"), "Resetting the board left stale presence frames")
      check(true, "Reset frames are removed")
    }
    output.textContent = `PASS ${count} whiteboard checks`
  } catch (error) { output.textContent = `FAIL: ${error instanceof Error ? error.message : error}` }
  finally { button.disabled = false }
})
