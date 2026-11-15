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
// Observe one committed paint; do not wait for a follower spring to catch up.
const paintedFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
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
let commitForChecks = (_ops: BoardOperation[]) => {}
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
function drawingOutline(id: string) { return drawingFrame(id)?.querySelector<SVGSVGElement>(".wb-drawing-outline") }
function drawingCursor(id: string) { return drawingFrame(id)?.querySelector<HTMLElement>(".wb-drawing-cursor") }
function drawingCursorLabel(id: string) { return drawingFrame(id)?.querySelector<HTMLElement>(".wb-drawing-cursor-label") }
function hasDrawingPresence() { return !!document.querySelector(".wb-drawing-frame, .wb-drawing-cursor, .wb-drawing-cursor-label") }
async function waitForCursor(id: string) {
  let previousLabel: DOMRect | undefined
  let settledFrames = 0
  await waitForDOM(() => {
    const frame = drawingFrame(id), outline = drawingOutline(id), cursor = drawingCursor(id), label = drawingCursorLabel(id)
    if (!frame || !outline || !cursor || !label) return false
    const rect = outline.getBoundingClientRect(), tip = cursor.getBoundingClientRect(), labelRect = label.getBoundingClientRect()
    const zoom = frame.getBoundingClientRect().width / Number.parseFloat(frame.style.width)
    const aligned = Math.abs(tip.left - rect.right) <= 1 && Math.abs(tip.top - rect.bottom) <= 1
    const entered = Math.abs(tip.width - 24 * zoom) < .5 && Math.abs(tip.height - 24 * zoom) < .5
    const labelSettled = previousLabel && Math.abs(labelRect.left - previousLabel.left) < .25 && Math.abs(labelRect.top - previousLabel.top) < .25 && Math.abs(labelRect.width - previousLabel.width) < .25 && Math.abs(labelRect.height - previousLabel.height) < .25
    settledFrames = aligned && entered && labelSettled ? settledFrames + 1 : 0
    previousLabel = labelRect
    return settledFrames >= 3 && labelRect.left > tip.left + 2 && labelRect.top > tip.top + 2
  }, `${id} cursor did not settle at the drawing frame's lower-right corner with its following label`, 2500)
}
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
  commitForChecks = ops => commit(ops, "agent")
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
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) check(pathAnimations.length > 0 && pathAnimations.every(animation => Math.abs(animation.playbackRate - 1 / 2) < .001), "Drawing animations do not share the slower playback rate")
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
    await waitForDOM(() => !hasDrawingPresence(), "Completed drawing left a presence frame or cursor")
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      await replayPresence()
      check(!hasDrawingPresence() && !drawingAnimations().length, "Reduced motion shows a presence frame, cursor, or pending drawing animation")
      check(document.querySelector(".wb-status")?.getAttribute("data-drawing") === "false", "Reduced motion leaves the drawing status active")
    } else {
      await replayPresence()
      const livePath = document.querySelector<SVGPathElement>('.react-flow__edge[data-id="return"] .react-flow__edge-path')!
      const completedPath = document.querySelector<SVGPathElement>('.react-flow__edge[data-id="write"] .react-flow__edge-path')!
      const liveTrace = livePath.getAnimations().find(animation => animation instanceof CSSAnimation && animation.animationName === "wb-trace")!
      const liveTiming = liveTrace.effect!.getTiming()
      liveTrace.currentTime = Number(liveTiming.delay) + Number(liveTiming.duration) * .5
      await nextFrame()
      const liveTime = Number(liveTrace.currentTime)
      const removedEdges = new Set<string>()
      const observer = new MutationObserver(records => {
        for (const record of records) for (const removed of record.removedNodes) {
          if (removed === livePath || removed.contains(livePath)) removedEdges.add("return")
          if (removed === completedPath || removed.contains(completedPath)) removedEdges.add("write")
        }
      })
      observer.observe(document.querySelector(".react-flow")!, { childList: true, subtree: true })
      const checkStableEdges = async (action: string) => {
        await nextFrame()
        check(!removedEdges.size && livePath.isConnected && completedPath.isConnected, `${action} detached an existing connector: ${[...removedEdges].join(", ")}`)
        check(document.querySelector('.react-flow__edge[data-id="return"] .react-flow__edge-path') === livePath && document.querySelector('.react-flow__edge[data-id="write"] .react-flow__edge-path') === completedPath, `${action} remounted an existing connector`)
        check(livePath.getAnimations().includes(liveTrace) && Number(liveTrace.currentTime) >= liveTime - .01, `${action} restarted the active connector's drawing clock`)
        check(!completedPath.closest(".wb-drawing") && Math.abs(Number.parseFloat(getComputedStyle(completedPath).strokeDashoffset)) < .01 && getComputedStyle(completedPath).visibility !== "hidden", `${action} hides or redraws an already completed connector`)
      }
      const meetsFileHandle = (path: SVGPathElement, end: boolean, handleId: string) => {
        const handle = document.querySelector<HTMLElement>(`[data-id="file"] [data-handleid="${handleId}"]`)
        const matrix = path.getScreenCTM()
        if (!handle || !matrix) return false
        const point = path.getPointAtLength(end ? path.getTotalLength() : 0)
        const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(matrix)
        const rect = handle.getBoundingClientRect()
        // React Flow attaches to the handle's outward edge, not its center.
        const x = handleId === "target-left" ? rect.left : rect.left + rect.width / 2
        const y = handleId === "source-bottom" ? rect.bottom : rect.top + rect.height / 2
        return Math.abs(screenPoint.x - x) <= 1 && Math.abs(screenPoint.y - y) <= 1
      }
      try {
        document.querySelector('[data-id="browser"] .wb-drawing')!.getAnimations({ subtree: true }).forEach(animation => animation.finish())
        await waitForDOM(() => !document.querySelector('[data-id="browser"] .wb-drawing'), "Unrelated node cue did not finish")
        await checkStableEdges("Completing an unrelated node cue")
        commitForChecks([{ op: "set", id: "stability-note", element: { type: "text", x: 1210, y: 40, w: 180, h: 48, text: "Unrelated live addition" } }])
        await waitForDOM(() => !!document.querySelector('[data-id="stability-note"]'), "Unrelated live node did not render")
        await checkStableEdges("Adding an unrelated live element")
        commitForChecks([{ op: "update", id: "agent", patch: { text: "Agent updated" } }])
        await waitForDOM(() => document.querySelector('[data-id="agent"] .wb-label')?.textContent === "Agent updated", "Same-ID node update did not render")
        await checkStableEdges("Updating an existing node without changing its size")
        commitForChecks([{ op: "update", id: "return", patch: { label: "实时推送 · 更新" } }])
        await waitForDOM(() => [...document.querySelectorAll(".wb-arrow-label")].some(label => label.textContent === "实时推送 · 更新"), "Same-ID connector label update did not render")
        await checkStableEdges("Updating an existing connector label")
        const beforeMoveLive = livePath.getAttribute("d"), beforeMoveCompleted = completedPath.getAttribute("d")
        commitForChecks([{ op: "update", id: "file", patch: { x: 566, y: 96 } }])
        await waitForDOM(() => livePath.getAttribute("d") !== beforeMoveLive && completedPath.getAttribute("d") !== beforeMoveCompleted && meetsFileHandle(livePath, false, "source-bottom") && meetsFileHandle(completedPath, true, "target-left"), "Moving an attached node did not reroute both connectors to its new handle positions")
        check(true, "Attached node movement updates active and completed connector geometry")
        await checkStableEdges("Moving an attached node")
        const beforeResizeLive = livePath.getAttribute("d"), beforeResizeCompleted = completedPath.getAttribute("d")
        commitForChecks([{ op: "update", id: "file", patch: { w: 210, h: 140 } }])
        await waitForDOM(() => livePath.getAttribute("d") !== beforeResizeLive && completedPath.getAttribute("d") !== beforeResizeCompleted && meetsFileHandle(livePath, false, "source-bottom") && meetsFileHandle(completedPath, true, "target-left"), "Resizing an attached node left connector endpoints at stale measured bounds")
        check(true, "ResizeObserver updates active and completed connector endpoints after a size change")
        await checkStableEdges("Resizing an attached node")
      } finally { observer.disconnect() }
      drawingAnimations().forEach(animation => animation.finish())
      await waitForDOM(() => !hasDrawingPresence(), "Live stability fixture left unfinished drawing cues")

      await replayPresence()
      const presenceAnimations = drawingAnimations()
      check(presenceAnimations.length > 14, "Presence fixture is missing staggered table rows")
      check(!document.querySelector(".wb-drawing-frame"), "Queued elements show presence frames before their animations start")
      presenceAnimations.forEach(animation => { animation.currentTime = 1001 })
      await waitForDOM(() => presenceIds.every(id => drawingFrame(id)), "Started drawing did not show per-element presence frames")
      check(!document.querySelector(".wb-drawing-tab"), "Drawing presence still renders the obsolete upper-left tab")
      await paintedFrame()
      for (const id of presenceIds) {
        const frame = drawingFrame(id)!, outline = drawingOutline(id)!.getBoundingClientRect()
        const cursor = drawingCursor(id)!.getBoundingClientRect(), label = drawingCursorLabel(id)!.getBoundingClientRect()
        const zoom = frame.getBoundingClientRect().width / Number.parseFloat(frame.style.width)
        check(Math.abs(cursor.width - 24 * zoom) < .5 && Math.abs(cursor.height - 24 * zoom) < .5, `${id} cursor is not full size in its first drawing frame`)
        check(Math.abs(cursor.left - outline.right) <= 1 && Math.abs(cursor.top - outline.bottom) <= 1 && Math.abs(label.left - outline.right - 16 * zoom) <= 1 && Math.abs(label.top - outline.bottom - 24 * zoom) <= 1, `${id} first drawing frame has a cursor or label position lag`)
      }
      for (const id of presenceIds) {
        await waitForCursor(id)
        const frame = drawingFrame(id)!
        const outline = drawingOutline(id)!
        const rectStyle = getComputedStyle(outline.querySelector("rect")!)
        const cursor = drawingCursor(id)!, label = drawingCursorLabel(id)!
        check(rectStyle.stroke === "rgb(96, 165, 250)" && rectStyle.strokeDasharray !== "none" && Number.parseFloat(rectStyle.strokeDasharray) > 0, `${id} lost its light blue dashed border`)
        check(rectStyle.fill === "rgba(96, 165, 250, 0.06)", `${id} has no pale blue fill`)
        check(rectStyle.vectorEffect === "non-scaling-stroke", `${id} scales its dashed stroke thickness with drawing progress`)
        const cursorPath = cursor.querySelector("svg path")!
        check(cursorPath && getComputedStyle(cursorPath).fill === "rgb(96, 165, 250)", `${id} lost its light blue drawing cursor`)
        check(label.textContent === "Bambuddy" && getComputedStyle(label).backgroundColor === "rgb(96, 165, 250)", `${id} lost its blue Bambuddy cursor label`)
        check(getComputedStyle(label).color === (params.has("dark") ? "rgb(7, 30, 64)" : "rgb(255, 255, 255)"), `${id} has the wrong Bambuddy text color for its theme`)
        check(getComputedStyle(frame).pointerEvents === "none" && frame.getAttribute("aria-hidden") === "true", `${id} presence intercepts input or accessibility navigation`)
        const rect = outline.getBoundingClientRect(), tip = cursor.getBoundingClientRect(), labelRect = label.getBoundingClientRect()
        check(Math.abs(tip.left - rect.right) <= 1 && Math.abs(tip.top - rect.bottom) <= 1 && labelRect.left > tip.left && labelRect.top > tip.top, `${id} cursor and label do not follow the lower-right border`)
        check(rect.width > 0 && rect.height > 0 && rect.width < frame.getBoundingClientRect().width * .5, `${id} does not begin with a small visible drawing frame`)
      }
      const progressForFrame = (id: string) => {
        const frame = drawingFrame(id)!, full = frame.getBoundingClientRect(), visible = drawingOutline(id)!.getBoundingClientRect()
        const zoom = full.width / Number.parseFloat(frame.style.width)
        const padding = 16 * zoom
        return { x: (visible.width - padding) / (full.width - padding), y: (visible.height - padding) / (full.height - padding) }
      }
      for (const id of ["browser", "return", "stroke"]) {
        const path = document.querySelector<SVGPathElement>(`[data-id="${id}"] .wb-outline, [data-id="${id}"] .react-flow__edge-path, [data-id="${id}"] path.wb-stroke`)!
        const trace = path.getAnimations().find(animation => animation instanceof CSSAnimation && animation.animationName === "wb-trace")!
        const timing = trace.effect!.getTiming(), delay = Number(timing.delay), duration = Number(timing.duration)
        const initialCursor = drawingCursor(id)!.getBoundingClientRect(), initialLabel = drawingCursorLabel(id)!.getBoundingClientRect()
        const checkSynchronizedPaint = (phase: string) => {
          const frame = drawingFrame(id)!, rect = drawingOutline(id)!.getBoundingClientRect()
          const cursor = drawingCursor(id)!.getBoundingClientRect(), label = drawingCursorLabel(id)!.getBoundingClientRect()
          const zoom = frame.getBoundingClientRect().width / Number.parseFloat(frame.style.width)
          const progress = 1 - Number.parseFloat(getComputedStyle(path).strokeDashoffset), scaled = progressForFrame(id)
          const cursorError = [cursor.left - rect.right, cursor.top - rect.bottom]
          const labelError = [label.left - rect.right - 16 * zoom, label.top - rect.bottom - 24 * zoom]
          check(Math.abs(scaled.x - progress) < .02 && Math.abs(scaled.y - progress) < .02, `${id} ${phase}: frame progress differs from the rendered ink in the same paint`)
          check([...cursorError, ...labelError].every(error => Math.abs(error) <= 1), `${id} ${phase}: follower lags in the same paint (cursor ${cursorError.map(value => value.toFixed(2)).join(",")}px; label ${labelError.map(value => value.toFixed(2)).join(",")}px)`)
          check(Math.abs(cursor.width - initialCursor.width) < .5 && Math.abs(cursor.height - initialCursor.height) < .5 && Math.abs(label.width - initialLabel.width) < .5 && Math.abs(label.height - initialLabel.height) < .5, `${id} ${phase}: cursor or label changes size with drawing progress`)
        }
        trace.currentTime = delay + duration * .08
        await paintedFrame()
        checkSynchronizedPaint("paused seek to 8%")
        const firstRect = drawingOutline(id)!.getBoundingClientRect()
        const firstCursor = drawingCursor(id)!.getBoundingClientRect()
        const firstLabel = drawingCursorLabel(id)!.getBoundingClientRect()
        const firstProgress = 1 - Number.parseFloat(getComputedStyle(path).strokeDashoffset)
        const firstScale = progressForFrame(id)
        check(Math.abs(firstScale.x - firstProgress) < .02 && Math.abs(firstScale.y - firstProgress) < .02, `${id} frame does not follow the actual eased path progress`)
        trace.currentTime = delay + duration * .35
        await paintedFrame()
        checkSynchronizedPaint("paused seek to 35%")
        const middleRect = drawingOutline(id)!.getBoundingClientRect()
        const middleCursor = drawingCursor(id)!.getBoundingClientRect()
        const middleLabel = drawingCursorLabel(id)!.getBoundingClientRect()
        const middleProgress = 1 - Number.parseFloat(getComputedStyle(path).strokeDashoffset)
        const middleScale = progressForFrame(id)
        check(middleRect.width > firstRect.width + 1 && middleRect.height > firstRect.height + 1 && Math.abs(middleRect.left - firstRect.left) < .5 && Math.abs(middleRect.top - firstRect.top) < .5, `${id} frame does not grow diagonally from its fixed upper-left corner`)
        check(Math.abs(middleCursor.width - firstCursor.width) < .5 && Math.abs(middleCursor.height - firstCursor.height) < .5 && Math.abs(middleLabel.width - firstLabel.width) < .5 && Math.abs(middleLabel.height - firstLabel.height) < .5, `${id} cursor or Bambuddy label scales with drawing progress`)
        check(Math.abs(middleCursor.left - middleRect.right) <= 1 && Math.abs(middleCursor.top - middleRect.bottom) <= 1 && middleLabel.left > middleCursor.left && middleLabel.top > middleCursor.top, `${id} cursor or follower label diverges from the expanding lower-right corner`)
        check(middleProgress > firstProgress && Math.abs(middleScale.x - middleProgress) < .02 && Math.abs(middleScale.y - middleProgress) < .02, `${id} frame and trace diverge midway through drawing`)
        trace.currentTime = delay + duration * .04
        await paintedFrame()
        checkSynchronizedPaint("backward seek")
        const playbackRate = trace.playbackRate
        trace.updatePlaybackRate(.25)
        trace.play()
        await trace.ready
        let previousTime = Number(trace.currentTime)
        for (let frame = 0; frame < 8; frame++) {
          await paintedFrame()
          checkSynchronizedPaint(`slow playback frame ${frame + 1}`)
          check(trace.playbackRate === .25 && Number(trace.currentTime) >= previousTime, `${id} slow playback does not advance on its actual animation clock`)
          previousTime = Number(trace.currentTime)
        }
        trace.pause()
        await trace.ready
        const pausedTime = Number(trace.currentTime)
        for (let frame = 0; frame < 3; frame++) {
          await paintedFrame()
          checkSynchronizedPaint(`paused frame ${frame + 1}`)
          check(Math.abs(Number(trace.currentTime) - pausedTime) < .01, `${id} animation clock advances while paused`)
        }
        trace.updatePlaybackRate(playbackRate)
        trace.currentTime = delay + duration
        await paintedFrame()
        checkSynchronizedPaint("path endpoint")
        const completedScale = progressForFrame(id)
        check(Math.abs(completedScale.x - 1) < .01 && Math.abs(completedScale.y - 1) < .01, `${id} frame does not reach its complete bounds at the path endpoint`)
      }
      for (const id of ["vote", "table"]) {
        const animations = document.querySelector(`[data-id="${id}"] .wb-drawing`)!.getAnimations({ subtree: true })
        const start = Math.min(...animations.map(animation => Number(animation.effect!.getTiming().delay)))
        const end = Math.max(...animations.map(animation => Number(animation.effect!.getComputedTiming().endTime)))
        animations.forEach(animation => { animation.currentTime = start + (end - start) * .25 })
        await nextFrame()
        const first = drawingOutline(id)!.getBoundingClientRect()
        animations.forEach(animation => { animation.currentTime = start + (end - start) * .7 })
        await nextFrame()
        const middle = drawingOutline(id)!.getBoundingClientRect()
        check(middle.width > first.width + 1 && middle.height > first.height + 1 && Math.abs(middle.left - first.left) < .5 && Math.abs(middle.top - first.top) < .5, `${id} frame does not grow with its non-path content animation`)
        const progress = progressForFrame(id)
        check(Math.abs(progress.x - .7) < .02 && Math.abs(progress.y - .7) < .02, `${id} frame does not use the complete staggered animation timeline`)
        // Keep the last animation pending so its nearly complete frame can be measured.
        animations.forEach(animation => { animation.currentTime = end - .01 })
        await nextFrame()
      }
      const contains = (outer: DOMRect, inner: DOMRect) => outer.left <= inner.left + 1 && outer.top <= inner.top + 1 && outer.right >= inner.right - 1 && outer.bottom >= inner.bottom - 1
      const returnFrame = drawingOutline("return")!.getBoundingClientRect()
      const returnLine = document.querySelector<SVGPathElement>('.react-flow__edge[data-id="return"] .react-flow__edge-path')!
      const returnLabel = [...document.querySelectorAll<HTMLElement>(".wb-arrow-label")].find(element => element.textContent === "实时推送")!
      check(contains(returnFrame, returnLine.getBoundingClientRect()), "Return connector bends escape its presence frame")
      check(contains(returnFrame, returnLabel.getBoundingClientRect()), "Return connector label escapes its presence frame")
      for (const id of ["vote", "table"]) {
        const outline = drawingOutline(id)!
        const node = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!
        check(contains(outline.getBoundingClientRect(), node.getBoundingClientRect()) && !outline.closest(".wb-html, .wb-table"), `${id} clips its presence frame`)
      }
      checkLabelCoverage()
      const beforeZoom = drawingOutline("browser")!.getBoundingClientRect()
      const zoomIn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.getAttribute("aria-label") === i18n.t("whiteboard.zoomIn"))!
      zoomIn.click()
      await waitForDOM(() => drawingOutline("browser")!.getBoundingClientRect().width > beforeZoom.width + 1, "Zoom did not scale the presence frame")
      await waitForCursor("browser")
      const browserNode = document.querySelector<HTMLElement>('.react-flow__node[data-id="browser"]')!
      check(contains(drawingOutline("browser")!.getBoundingClientRect(), browserNode.getBoundingClientRect()), "Zoom moves the frame away from its element")
      const beforePan = drawingOutline("browser")!.getBoundingClientRect()
      const pane = document.querySelector<HTMLElement>(".react-flow__pane")!
      const paneRect = pane.getBoundingClientRect()
      pane.dispatchEvent(new WheelEvent("wheel", { deltaX: 80, deltaY: 40, bubbles: true, cancelable: true, clientX: paneRect.x + paneRect.width / 2, clientY: paneRect.y + paneRect.height / 2 }))
      await waitForDOM(() => Math.abs(drawingOutline("browser")!.getBoundingClientRect().x - beforePan.x) > 1, "Pan did not move the presence frame")
      await waitForCursor("browser")
      check(contains(drawingOutline("browser")!.getBoundingClientRect(), browserNode.getBoundingClientRect()), "Pan moves the frame away from its element")
      // Start a fresh reveal: geometry checks above already advanced it near completion.
      await replayPresence()
      const tableLifecycleAnimations = drawingAnimations()
      tableLifecycleAnimations.forEach(animation => { animation.currentTime = 1100 })
      await waitForDOM(() => !!drawingFrame("table"), "Incremental table reveal did not start")
      const lastRow = document.querySelector(".wb-table tbody tr:last-child")!
      const lastRowAnimation = tableLifecycleAnimations.find(animation => animation.effect instanceof KeyframeEffect && animation.effect.target === lastRow)!
      const completedTableAnimations = tableLifecycleAnimations.filter(animation => animation !== lastRowAnimation && animation.effect instanceof KeyframeEffect && animation.effect.target?.closest(".wb-table"))
      const rowTiming = lastRowAnimation.effect!.getTiming()
      lastRowAnimation.currentTime = Number(rowTiming.delay) + Number(rowTiming.duration) * .5
      tableLifecycleAnimations.filter(animation => animation !== lastRowAnimation).forEach(animation => animation.finish())
      await nextFrame()
      check(Number(lastRowAnimation.currentTime) > 1900 && !!drawingFrame("table"), "Long table presence ends before its final row finishes")
      check(document.querySelectorAll(".wb-drawing-frame").length === 1 && document.querySelector(".wb-status")?.getAttribute("data-drawing") === "true", "Finished elements or toolbar do not follow individual animation completion")
      const beforeAppend = drawingOutline("table")!.getBoundingClientRect()
      const beforeAppendProgress = progressForFrame("table")
      check(beforeAppendProgress.x > 0 && beforeAppendProgress.x < .95 && beforeAppendProgress.y < .95, "Incremental reveal fixture is already complete before rows are appended")
      appendRowsForChecks()
      await waitForDOM(() => document.querySelectorAll(".wb-table tbody tr").length === 16, "Incremental rows did not render during the existing drawing cue")
      const appendedRows = [...document.querySelectorAll(".wb-table tbody tr")].slice(14)
      const appendedAnimations = drawingAnimations().filter(animation => animation.effect instanceof KeyframeEffect && appendedRows.includes(animation.effect.target as Element))
      check(appendedAnimations.length === 2, "Incremental rows did not join the current cue's animation lifecycle")
      appendedAnimations.forEach(animation => { animation.pause(); animation.currentTime = 0 })
      await nextFrame()
      check(completedTableAnimations.length > 0 && completedTableAnimations.every(animation => animation.playState === "finished" && Number(animation.currentTime) >= Number(animation.effect!.getComputedTiming().endTime) - .01), "Appending rows restarts previously finished table animations")
      const afterAppend = drawingOutline("table")!.getBoundingClientRect()
      check(afterAppend.width >= beforeAppend.width - .5 && afterAppend.height >= beforeAppend.height - .5, "Appending rows shrinks the existing drawing frame")
      lastRowAnimation.finish()
      await nextFrame()
      check(!!drawingFrame("table") && document.querySelector(".wb-status")?.getAttribute("data-drawing") === "true", "Finishing the old rows cleared the same cue while appended rows were still pending")
      appendedAnimations.forEach(animation => {
        const timing = animation.effect!.getTiming()
        animation.currentTime = Number(timing.delay) + Number(timing.duration) * .5
      })
      await nextFrame()
      const appendedMiddle = drawingOutline("table")!.getBoundingClientRect()
      const appendedProgress = progressForFrame("table")
      check(appendedMiddle.width > afterAppend.width + 1 && appendedMiddle.height > afterAppend.height + 1 && appendedProgress.x < .9999 && appendedProgress.y < .9999, "Appended rows do not advance the frame gradually before they finish")
      appendedAnimations.forEach(animation => animation.finish())
      await waitForDOM(() => !hasDrawingPresence() && document.querySelector(".wb-status")?.getAttribute("data-drawing") === "false", "Final appended row did not clear frame, cursor, and drawing status")
      check(true, "All completed frames and drawing status are cleared")

      await replayPresence()
      const cancelledAnimations = drawingAnimations()
      cancelledAnimations.forEach(animation => { animation.currentTime = 1100 })
      await waitForDOM(() => !!drawingFrame("vote"), "Cancellation fixture did not start")
      deleteForChecks("vote")
      await waitForDOM(() => !drawingFrame("vote") && !document.querySelector('.react-flow__node[data-id="vote"]'), "Deleting an element left its presence frame")
      check(true, "Deleted element frame is removed")
      cancelledAnimations.forEach(animation => animation.cancel())
      await waitForDOM(() => !hasDrawingPresence(), "Cancelled animations left presence frames or cursors")
      check(true, "Cancelled animation frames are removed")

      await replayNarrowPerson()
      const personPath = document.querySelector<SVGPathElement>('[data-id="person"] .wb-outline')!
      const personNode = document.querySelector<HTMLElement>('.react-flow__node[data-id="person"]')!
      const personTrace = personPath.getAnimations().find(animation => animation instanceof CSSAnimation && animation.animationName === "wb-trace")!
      personTrace.currentTime = Number(personTrace.effect!.getComputedTiming().endTime)
      await nextFrame()
      check(personPath.getBBox().width > 32 && personPath.getBoundingClientRect().width > personNode.getBoundingClientRect().width, "Narrow person fixture does not exercise geometry outside its node box")
      check(contains(drawingOutline("person")!.getBoundingClientRect(), personPath.getBoundingClientRect()), "Narrow person's head escapes its drawing frame")
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
      await waitForDOM(() => !hasDrawingPresence(), "Replaced cue did not clean up its frame and cursor after its own completion")
      check(true, "Only the matching cue completion clears its frame")

      await replayPresence()
      drawingAnimations().forEach(animation => { animation.currentTime = 1100 })
      await waitForDOM(() => !!drawingFrame("browser"), "Reset fixture did not start")
      resetFixture()
      await waitForDOM(() => !hasDrawingPresence() && !document.querySelector(".wb-drawing"), "Resetting the board left stale presence frames or cursors")
      check(true, "Reset frames are removed")
    }
    output.textContent = `PASS ${count} whiteboard checks`
  } catch (error) { output.textContent = `FAIL: ${error instanceof Error ? error.message : error}` }
  finally { button.disabled = false }
})
