import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import { TooltipProvider } from "../../../src/components/ui/tooltip"
import { WhiteboardCanvas } from "../../../src/features/whiteboard/whiteboard-renderer"
import { captureWhiteboard, whiteboardPdfBlob } from "../../../src/features/whiteboard/whiteboard-export"
import { applyBoardChange, type AnimationCue, type Board, type BoardElement } from "../../../src/features/whiteboard/whiteboard-model"
import { fixtureBoard } from "./whiteboard-fixture"
import i18n from "../../../src/i18n"
import "../../../src/index.css"

const params = new URLSearchParams(location.search)
await i18n.changeLanguage(params.has("en") ? "en" : "zh-CN")
document.documentElement.classList.toggle("dark", params.has("dark"))
const host = document.querySelector<HTMLDivElement>("#page")!
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
function waitForDOM(condition: () => boolean, message: string, timeout = 5000) {
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
const markers = [
  { id: "north-west", x: -220, y: -160, rgb: [239, 35, 60] },
  { id: "north-east", x: params.has("huge") ? 24000 : 1380, y: -160, rgb: [0, 181, 106] },
  { id: "south-west", x: -220, y: 1000, rgb: [255, 183, 3] },
  { id: "south-east", x: params.has("huge") ? 24000 : 1380, y: 1000, rgb: [112, 72, 232] },
]
function squareDataUrl(rgb: number[]) {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><path fill="rgb(${rgb.join(",")})" d="M0 0H64V64H0Z"/></svg>`)}`
}
const table = fixtureBoard.elements.table
const vote = fixtureBoard.elements.vote
if (table.type !== "table" || vote.type !== "html") throw new Error("Expected table and HTML fixtures")
const elements: Record<string, BoardElement> = {
  ...fixtureBoard.elements,
  vote: { ...vote, state: { votes: 17 }, html: vote.html + `<div id="export-state-proof" style="width:80px;height:24px"></div><script>whiteboard.subscribe(s=>{document.getElementById('export-state-proof').style.background=s?.votes===17?'rgb(19,201,91)':'rgb(230,15,15)'});</script>` },
  table: { ...table, rows: Array.from({ length: 14 }, (_, row) => [`Row ${row + 1}`, "保留滚动状态", "sm"]) },
  "overflow-person": { type: "shape", kind: "person", x: -240, y: 200, w: 32, h: 200, color: "rose", text: "" },
  ...Object.fromEntries(markers.map(marker => [marker.id, { type: "image", x: marker.x, y: marker.y, w: 64, h: 64, src: squareDataUrl(marker.rgb), alt: marker.id } satisfies BoardElement])),
}
const exportBoard: Board = { ...fixtureBoard, title: "完整白板导出验证", elements, order: Object.keys(elements) }
let prepareDrawing = async () => {}
export function ExportFixture() {
  const [board, setBoard] = useState(exportBoard)
  const [cues, setCues] = useState<Record<string, AnimationCue>>({})
  prepareDrawing = async () => {
    setCues({})
    await nextFrame()
    setCues(Object.fromEntries(["browser", "return", "stroke"].map(id => [id, { revision: board.revision, delay: 1000 }])))
    await waitForDOM(() => !!host.querySelector('.react-flow__edge[data-id="return"] .wb-drawing'), "Drawing fixture did not mount")
  }
  return <TooltipProvider><WhiteboardCanvas board={board} cues={cues} onDrawingComplete={(id, revision) => setCues(previous => {
    if (previous[id]?.revision !== revision) return previous
    const next = { ...previous }; delete next[id]; return next
  })} onWrite={ops => setBoard(previous => applyBoardChange(previous, previous.revision + 1, ops, previous.title))} /></TooltipProvider>
}
const root = createRoot(host)
root.render(<StrictMode><ExportFixture /></StrictMode>)
import.meta.hot?.dispose(() => root.unmount())

function blobDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error("Could not read export artifact"))
    reader.readAsDataURL(blob)
  })
}
function canvasImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("Exported PNG did not decode"))
    image.src = src
  })
}
function rgbMatches(pixels: Uint8ClampedArray, offset: number, rgb: number[]) {
  return rgb.every((value, channel) => Math.abs(pixels[offset + channel] - value) <= 3) && pixels[offset + 3] > 250
}
document.querySelector<HTMLButtonElement>("#checks")!.addEventListener("click", async event => {
  const button = event.currentTarget as HTMLButtonElement
  const output = document.querySelector<HTMLElement>("#results")!
  const pngLink = document.querySelector<HTMLAnchorElement>("#png")!
  const pdfLink = document.querySelector<HTMLAnchorElement>("#pdf")!
  const preview = document.querySelector<HTMLImageElement>("#preview")!
  button.disabled = true
  pngLink.hidden = pdfLink.hidden = preview.hidden = true
  output.textContent = "Capturing complete whiteboard…"
  let count = 0
  try {
    const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); count++ }
    await waitForDOM(() => host.querySelectorAll(".react-flow__edge-path").length === 3 && !!host.querySelector('[data-id="overflow-person"] .wb-outline'), "React Flow did not finish measuring the board")
    await document.fonts.ready
    const surface = host.querySelector<HTMLElement>(".whiteboard")!
    const viewport = surface.querySelector<HTMLElement>(".react-flow__viewport")!
    const frame = surface.querySelector<HTMLIFrameElement>("iframe")!
    check(frame.getAttribute("sandbox") === "allow-scripts", "HTML fixture must remain opaque and sandboxed")
    const person = surface.querySelector<SVGPathElement>('[data-id="overflow-person"] .wb-outline')!
    check(person.getBBox().x < 0 && person.getBBox().width > 32, "Person fixture does not extend beyond its nominal box")
    const tableScroll = surface.querySelector<HTMLElement>(".wb-table-scroll")!
    tableScroll.scrollTop = 72
    const tableScrollTop = tableScroll.scrollTop
    await prepareDrawing()
    const animations = [...new Set([...surface.querySelectorAll(".wb-drawing, .wb-arrow-label-drawing")].flatMap(element => element.getAnimations({ subtree: true })))].filter(animation => animation instanceof CSSAnimation)
    animations.forEach(animation => animation.pause())
    await Promise.all(animations.map(animation => animation.ready))
    animations.forEach(animation => { animation.currentTime = 1150 })
    await nextFrame()
    const liveTimes = animations.map(animation => Number(animation.currentTime))
    const viewportTransform = viewport.style.transform
    const hasMotion = !matchMedia("(prefers-reduced-motion: reduce)").matches
    if (hasMotion) check(animations.length > 0 && !!surface.querySelector(".wb-drawing-frame"), "Live drawing fixture is not paused mid-animation")
    const capture = await captureWhiteboard(surface)
    check(capture.blob.type === "image/png" && capture.blob.size > 1000, "PNG artifact is empty or has the wrong type")
    check(capture.width >= (params.has("huge") ? 24392 : 1772) - 2 && capture.height >= 1288 - 2, "Capture bounds omit negative coordinates, shape overflow or bottom content")
    check(viewport.style.transform === viewportTransform && tableScroll.scrollTop === tableScrollTop, "Export changed the live viewport or table scroll position")
    if (hasMotion) check(animations.every((animation, index) => animation.playState === "paused" && Number(animation.currentTime) === liveTimes[index]), "Export changed or completed the live drawing animations")
    const pngUrl = await blobDataUrl(capture.blob)
    const png = await canvasImage(pngUrl)
    check(png.naturalWidth <= 8192 && png.naturalHeight <= 8192 && png.naturalWidth * png.naturalHeight <= 32_000_000, "Export exceeds the raster size limit")
    const canvas = document.createElement("canvas")
    canvas.width = png.naturalWidth; canvas.height = png.naturalHeight
    const context = canvas.getContext("2d")!
    context.drawImage(png, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    const colors = [...markers.map(marker => marker.rgb), [19, 201, 91]]
    const matches = colors.map(() => 0)
    for (let offset = 0; offset < pixels.length; offset += 4) {
      colors.forEach((color, index) => { if (rgbMatches(pixels, offset, color)) matches[index]++ })
    }
    const scale = png.naturalWidth / capture.width
    markers.forEach((marker, index) => check(matches[index] >= (60 * scale) ** 2, `${marker.id} corner marker is missing or clipped`))
    check(matches[4] >= 100 * scale ** 2, "HTML iframe contents or current vote state are missing from the PNG")
    const rgbAt = (x: number, y: number) => {
      const offset = (Math.max(0, Math.min(canvas.height - 1, Math.round(y))) * canvas.width + Math.max(0, Math.min(canvas.width - 1, Math.round(x)))) * 4
      return [pixels[offset], pixels[offset + 1], pixels[offset + 2]]
    }
    const brightness = (rgb: number[]) => rgb.reduce((total, value) => total + value, 0) / 3
    const hasConnectorInk = (point: { x: number; y: number }, ink: number, radius: number) => {
      const x = (point.x - capture.bounds.x + 32) * scale
      const y = (point.y - capture.bounds.y + 32) * scale
      const distance = radius + Math.max(3, Math.ceil(4 * scale))
      const surroundings = [[-distance, -distance], [distance, -distance], [-distance, distance], [distance, distance]].map(([dx, dy]) => brightness(rgbAt(x + dx, y + dy))).sort((a, b) => a - b)
      const background = (surroundings[1] + surroundings[2]) / 2
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const color = rgbAt(x + dx, y + dy), value = brightness(color)
        if (Math.max(...color) - Math.min(...color) < 35 && Math.abs(value - background) >= 18 && Math.abs(value - ink) + 15 < Math.abs(background - ink)) return true
      }
      return false
    }
    // Edge labels can survive a broken SVG export, so inspect the actual free
    // curves and both arrowhead wings in the PNG rather than only DOM/bounds.
    const obstacles = [...surface.querySelectorAll<HTMLElement>(".react-flow__node-element, .wb-arrow-label")].filter(element => !element.querySelector(".wb-container")).map(element => element.getBoundingClientRect())
    const colorCanvas = document.createElement("canvas")
    colorCanvas.width = colorCanvas.height = 1
    const colorContext = colorCanvas.getContext("2d")!
    for (const id of ["select", "write", "return"]) {
      const path = surface.querySelector<SVGPathElement>(`.react-flow__edge[data-id="${id}"] .react-flow__edge-path`)!
      colorContext.clearRect(0, 0, 1, 1)
      colorContext.fillStyle = getComputedStyle(path).stroke
      colorContext.fillRect(0, 0, 1, 1)
      const ink = brightness([...colorContext.getImageData(0, 0, 1, 1).data].slice(0, 3))
      const length = path.getTotalLength(), matrix = path.getScreenCTM()!
      // Short arrows leave only narrow gaps beside opaque labels. Sample those
      // gaps too, and keep the obstacle margin in canvas units across zooms.
      const clearance = 2 * Math.hypot(matrix.a, matrix.b)
      const samples = Array.from({ length: 97 }, (_, index) => path.getPointAtLength(length * (.02 + index * .01))).filter(point => {
        const screen = point.matrixTransform(matrix)
        return !obstacles.some(rect => screen.x >= rect.left - clearance && screen.x <= rect.right + clearance && screen.y >= rect.top - clearance && screen.y <= rect.bottom + clearance)
      })
      const hits = samples.map(point => hasConnectorInk(point, ink, Math.max(1, Math.ceil(scale))))
      check(samples.length >= 2 && hits.every(Boolean), `${id} connector curve is missing from the PNG (${hits.filter(Boolean).length}/${samples.length} samples; failed ${samples.filter((_, index) => !hits[index]).map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" · ")})`)
      // The huge-board probe reduces a complete arrowhead to about two pixels;
      // its separate wings are only distinguishable in normal-size exports.
      if (scale >= 1) {
        const tip = path.getPointAtLength(length), prior = path.getPointAtLength(length - .1)
        const magnitude = Math.hypot(tip.x - prior.x, tip.y - prior.y)
        const dx = (tip.x - prior.x) / magnitude, dy = (tip.y - prior.y) / magnitude
        const wings = [-1, 1].map(side => ({ x: tip.x - dx * 5.2 - dy * side * 3.1, y: tip.y - dy * 5.2 + dx * side * 3.1 }))
        check(wings.every(point => hasConnectorInk(point, ink, Math.max(0, Math.floor(scale * .35)))), `${id} arrowhead wings are missing from the PNG`)
      }
    }
    const pdf = await whiteboardPdfBlob(capture)
    check(pdf.type === "application/pdf" && pdf.size > 1000, "PDF artifact is empty or has the wrong type")
    const pdfBytes = new Uint8Array(await pdf.arrayBuffer())
    const pdfText = new TextDecoder("latin1").decode(pdfBytes)
    check((pdfText.match(/\/Type\s*\/Page\b/g) ?? []).length === 1, "PDF splits the whiteboard across pages")
    const box = pdfText.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/)
    check(box && Number(box[1]) <= 14400 && Number(box[2]) <= 14400 && Math.abs(Number(box[1]) / Number(box[2]) - capture.width / capture.height) < .01, "PDF page size clips or distorts the complete whiteboard")
    pngLink.href = pngUrl
    pdfLink.href = await blobDataUrl(pdf)
    preview.src = pngUrl
    pngLink.hidden = pdfLink.hidden = preview.hidden = false
    output.textContent = `PASS ${count} export checks · PNG ${png.naturalWidth}×${png.naturalHeight} · PDF 1 complete page`
  } catch (error) { output.textContent = `FAIL: ${error instanceof Error ? error.message : error}` }
  finally { button.disabled = false }
})
