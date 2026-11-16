import { downloadBlob } from "@/features/files/preview/download-text-file"
import { captureWhiteboardEmbed } from "./whiteboard-embed-capture"
import { whiteboardExportLayout, whiteboardPdfPage, type WhiteboardExportRect } from "./whiteboard-export-geometry"

export type WhiteboardExportFormat = "png" | "pdf"
export type WhiteboardCapture = { blob: Blob; width: number; height: number; scale: number; bounds: WhiteboardExportRect }

const EXCLUDED = ".wb-pen, .wb-drawing-frame, .wb-claim, .react-flow__handle, .react-flow__resize-control, .react-flow__nodesselection, .react-flow__selection, .react-flow__edge-interaction, script"
const CONTENT = ".react-flow__node-element, .wb-shape-svg .wb-fill, .wb-shape-svg .wb-cap, .wb-stroke-svg path.wb-stroke, .wb-arrow .react-flow__edge-path, .wb-arrow-label, .wb-container > .wb-label"

async function imagesReady(root: ParentNode) {
  await Promise.all([...root.querySelectorAll<HTMLImageElement>("img")].map(async image => {
    if (!image.complete || !image.naturalWidth) {
      try { await image.decode() } catch { throw new Error("A whiteboard image could not be loaded for export.") }
    }
    if (!image.naturalWidth) throw new Error("A whiteboard image could not be loaded for export.")
  }))
}

/** Keep the live viewport and its animations untouched while preparing the final drawing. */
async function cloneViewport(viewport: HTMLElement) {
  const clone = viewport.cloneNode(true) as HTMLElement
  const inputs = [...viewport.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].map(input => input.value)
  const scrolls = [...viewport.querySelectorAll<HTMLElement>(".wb-table-scroll")].map(table => ({ top: table.scrollTop, left: table.scrollLeft }))
  const sourceFrames = [...viewport.querySelectorAll<HTMLIFrameElement>("iframe")]
  const clonedFrames = [...clone.querySelectorAll<HTMLIFrameElement>("iframe")]
  const snapshots = await Promise.all(sourceFrames.map(frame => captureWhiteboardEmbed(frame, 2)))
  clonedFrames.forEach((frame, index) => {
    const image = document.createElement("img")
    image.src = snapshots[index]
    image.className = frame.className
    image.setAttribute("style", frame.getAttribute("style") ?? "")
    image.style.objectFit = "fill"
    image.alt = frame.title
    frame.replaceWith(image)
  })
  clone.querySelectorAll(EXCLUDED).forEach(element => element.remove())
  for (const element of clone.querySelectorAll<HTMLElement>(".wb-drawing, .wb-arrow-label-drawing, .selected, .wb-arrow-selected")) element.classList.remove("wb-drawing", "wb-arrow-label-drawing", "selected", "wb-arrow-selected")
  clone.querySelectorAll<HTMLElement>(".react-flow__node-element").forEach(node => { node.style.zIndex = node.querySelector(".wb-container") ? "0" : "1" })
  clone.querySelectorAll<SVGElement>(".wb-arrow .react-flow__edge-path, .wb-arrow-head").forEach(path => { path.style.strokeWidth = "1.5" })
  clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea").forEach((input, index) => {
    input.value = inputs[index]
    if (input instanceof HTMLInputElement) input.setAttribute("value", input.value)
    else input.textContent = input.value
  })
  return { clone, scrolls }
}

export async function captureWhiteboard(surface: HTMLElement): Promise<WhiteboardCapture> {
  const viewport = surface.querySelector<HTMLElement>(".react-flow__viewport")
  if (!viewport || !viewport.querySelector(".react-flow__node-element, .wb-arrow")) throw new Error("The whiteboard is empty.")
  await document.fonts.ready
  await imagesReady(viewport)
  const { clone, scrolls } = await cloneViewport(viewport)
  if (!surface.isConnected) throw new Error("The whiteboard changed during export. Open it and try again.")
  const host = document.createElement("div")
  host.setAttribute("aria-hidden", "true")
  host.inert = true
  host.classList.toggle("dark", !!surface.closest(".dark"))
  Object.assign(host.style, { position: "fixed", left: "0", top: "0", width: "0", height: "0", overflow: "hidden", pointerEvents: "none" })
  const stage = document.createElement("div")
  // React Flow scopes edge SVG positioning/overflow to this ancestor class.
  stage.className = "whiteboard react-flow"
  stage.setAttribute("data-whiteboard-export", "")
  const sourceStyle = getComputedStyle(surface)
  for (const property of sourceStyle) if (property.startsWith("--")) stage.style.setProperty(property, sourceStyle.getPropertyValue(property))
  Object.assign(stage.style, { width: `${surface.clientWidth}px`, height: `${surface.clientHeight}px`, minHeight: "0", overflow: "visible", font: sourceStyle.font, color: sourceStyle.color, backgroundColor: sourceStyle.backgroundColor })
  Object.assign(clone.style, { transform: "none", transformOrigin: "0 0", left: "0", top: "0" })
  stage.append(clone)
  host.append(stage)
  // All iframe/script nodes have been removed before this clone reaches the document.
  document.body.append(host)
  try {
    clone.querySelectorAll<HTMLElement>(".wb-table-scroll").forEach((table, index) => {
      table.scrollTop = scrolls[index].top
      table.scrollLeft = scrolls[index].left
    })
    await imagesReady(stage)
    const origin = stage.getBoundingClientRect()
    const rectangles = [...clone.querySelectorAll(CONTENT)].map(element => {
      const rect = element.getBoundingClientRect()
      // SVG path rectangles exclude their stroke; wide freehand marks can exceed the node box.
      const matrix = element instanceof SVGGraphicsElement ? element.getScreenCTM() : null
      const halfStroke = matrix ? (Number.parseFloat(getComputedStyle(element).strokeWidth) || 0) * Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d)) / 2 : 0
      return { x: rect.x - origin.x - halfStroke, y: rect.y - origin.y - halfStroke, width: rect.width + halfStroke * 2, height: rect.height + halfStroke * 2 }
    })
    const layout = whiteboardExportLayout(rectangles)
    stage.style.width = `${layout.width}px`
    stage.style.height = `${layout.height}px`
    stage.style.overflow = "hidden"
    clone.style.transform = `translate(${layout.x}px, ${layout.y}px)`
    let missingAsset = false
    const { domToBlob } = await import("modern-screenshot")
    const blob = await domToBlob(stage, {
      width: layout.width, height: layout.height, scale: layout.scale, maximumCanvasSize: 8192,
      backgroundColor: sourceStyle.backgroundColor, features: { restoreScrollPosition: true }, timeout: 10_000,
      fetch: { placeholderImage: () => { missingAsset = true; return "" } },
    })
    if (missingAsset || !blob.size) throw new Error("The whiteboard could not be exported completely. Check that all images are available and try again.")
    return { blob, width: layout.width, height: layout.height, scale: layout.scale, bounds: layout.bounds }
  } finally {
    host.remove()
  }
}

export async function whiteboardPdfBlob(capture: WhiteboardCapture): Promise<Blob> {
  const page = whiteboardPdfPage(capture.width, capture.height)
  const { jsPDF } = await import("jspdf")
  const pdf = new jsPDF({ unit: "pt", format: [page.width, page.height], orientation: page.orientation, compress: true })
  const pixels = new Uint8Array(await capture.blob.arrayBuffer())
  pdf.addImage(pixels, "PNG", 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight())
  return pdf.output("blob")
}

export async function exportWhiteboard(surface: HTMLElement, format: WhiteboardExportFormat, filename: string): Promise<void> {
  const capture = await captureWhiteboard(surface)
  const blob = format === "pdf" ? await whiteboardPdfBlob(capture) : capture.blob
  const name = filename.replace(/\.board\.json$/i, "").replace(/\.(png|pdf)$/i, "") || "whiteboard"
  downloadBlob(`${name}.${format}`, blob)
}
