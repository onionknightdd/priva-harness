import { downloadBlob, downloadTextFile } from "@/features/files/preview/download-text-file"

import type { AgentThreadMessage } from "./agent-message-data"
import { assistantPieces } from "./assistant-pieces"
import { assistantTimeline } from "./assistant-timeline"

export type ReplyDownloadFormat = "pdf" | "markdown" | "png"

const A4_WIDTH = 595.28
const A4_HEIGHT = 841.89
const A4_MARGIN = 36
const CAPTURE_EDGE = 8192

export function assistantReplyMarkdown(message: AgentThreadMessage): string {
  return assistantTimeline(message)
    .flatMap((section) => assistantPieces(section.message))
    .flatMap((piece) => piece.kind === "answer" && piece.text.trim() !== "" ? [piece.text.trim()] : [])
    .join("\n\n")
}

export function assistantReplyHasImage(message: AgentThreadMessage): boolean {
  return assistantTimeline(message).some((section) => assistantPieces(section.message).some((piece) =>
    piece.kind === "visual" || (piece.kind === "answer" && piece.text.trim() !== "")))
}

/** UTC stamp so the same message keeps one name in every timezone. */
export function assistantReplyFileName(createdAt: string, extension: "md" | "png" | "pdf") {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return `reply.${extension}`
  const stamp = date.toISOString().slice(0, 16).replaceAll("-", "").replaceAll(":", "").replace("T", "-")
  return `reply-${stamp}.${extension}`
}

/** Top-level reply nodes only. A visual can contain nested markup, not another reply. */
export function replyElements(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-reply]")].filter((node) =>
    !node.parentElement?.closest("[data-reply]"))
}

const PAGE_PADDING = 24

export function replyCaptureScale(width: number, height: number) {
  if (width <= 0 || height <= 0) return 1
  return Math.min(2, CAPTURE_EDGE / width, CAPTURE_EDGE / height)
}

/** Pixel height of one A4 content box once the reply column is scaled to the page width. */
export function replyPageLimit(columnWidth: number) {
  const contentWidth = A4_WIDTH - A4_MARGIN * 2
  const contentHeight = A4_HEIGHT - A4_MARGIN * 2
  const pngWidth = Math.max(1, columnWidth + PAGE_PADDING * 2)
  return contentHeight * (pngWidth / contentWidth)
}

export type ReplyAtom = { rootIndex: number; path: number[]; height: number }

/** Break a tall reply into whole components. A card that fits on a page is never split. */
export function collectReplyAtoms(roots: readonly HTMLElement[], maxHeight: number): ReplyAtom[] {
  return roots.flatMap((root, rootIndex) =>
    splitAtom(root, maxHeight).map((node) => ({
      rootIndex,
      path: pathFrom(root, node),
      height: node.getBoundingClientRect().height,
    })))
}

/** `fits(start, end)` reports whether atoms in `[start, end)` still fit on one page. */
export function paginateByFit(count: number, fits: (start: number, end: number) => boolean) {
  const pages: Array<[number, number]> = []
  let start = 0
  while (start < count) {
    let end = start + 1
    while (end < count && fits(start, end + 1)) end += 1
    pages.push([start, end])
    start = end
  }
  return pages
}

export async function downloadAssistantReply(
  format: ReplyDownloadFormat,
  message: AgentThreadMessage,
  scope: HTMLElement | null
) {
  if (format === "markdown") {
    const text = assistantReplyMarkdown(message)
    if (text === "") throw new Error("empty reply")
    downloadTextFile(assistantReplyFileName(message.createdAt, "md"), text, "text/markdown")
    return
  }
  const nodes = scope ? replyElements(scope) : []
  if (nodes.length === 0) throw new Error("empty reply")
  const fileName = assistantReplyFileName(message.createdAt, format === "pdf" ? "pdf" : "png")
  if (format === "png") {
    const captured = await captureReply(nodes)
    downloadBlob(fileName, captured.blob)
    return
  }
  downloadBlob(fileName, await renderReplyPdf(nodes))
}

function layoutReplyPages(roots: readonly HTMLElement[]) {
  const columnWidth = replyColumnWidth(roots)
  const limit = replyPageLimit(columnWidth)
  const atoms = collectReplyAtoms(roots, Math.max(1, limit - PAGE_PADDING * 2))
  const pages = paginateByFit(atoms.length, (start, end) =>
    measureReplyPage(roots, atoms, atoms.slice(start, end), columnWidth) <= limit + 0.5)
  return { columnWidth, limit, atoms, pages }
}

async function captureReply(nodes: HTMLElement[]) {
  const stage = mountReplyStage(nodes)
  try {
    return await captureStage(stage)
  } finally {
    stage.parentElement?.remove()
  }
}

async function captureStage(stage: HTMLElement) {
  const { domToBlob } = await import("modern-screenshot")
  const width = stage.scrollWidth
  const height = stage.scrollHeight
  const blob = await domToBlob(stage, {
    scale: replyCaptureScale(width, height),
    backgroundColor: stage.style.backgroundColor,
  })
  return { blob, backgroundColor: stage.style.backgroundColor }
}

function mountReplyStage(nodes: HTMLElement[]) {
  const column = nodes[0]?.parentElement ?? document.body
  const stage = createReplyStage(
    replyColumnWidth(nodes),
    opaqueColor(paintedBackground(column))
  )
  copyStageText(stage, column)
  for (const node of nodes) stage.append(cloneReplyNode(node))
  document.body.append(stage.parentElement ?? stage)
  return stage
}

function copyStageText(stage: HTMLElement, sample: Element) {
  const computed = getComputedStyle(sample)
  stage.style.color = computed.color
  stage.style.font = computed.font
}

function createReplyStage(columnWidth: number, background: string) {
  const stage = document.createElement("div")
  const clip = document.createElement("div")
  stage.setAttribute("data-reply-export", "")
  stage.style.boxSizing = "content-box"
  stage.style.width = `${columnWidth}px`
  stage.style.padding = `${PAGE_PADDING}px`
  stage.style.display = "flex"
  stage.style.flexDirection = "column"
  stage.style.gap = "12px"
  stage.style.backgroundColor = background
  clip.style.position = "fixed"
  clip.style.left = "0"
  clip.style.top = "0"
  clip.style.width = "0"
  clip.style.height = "0"
  clip.style.overflow = "hidden"
  clip.style.pointerEvents = "none"
  clip.append(stage)
  return stage
}

function cloneReplyNode(node: HTMLElement) {
  const clone = node.cloneNode(true) as HTMLElement
  clone.style.transform = "none"
  const sources = node.querySelectorAll("canvas")
  const targets = clone.querySelectorAll("canvas")
  sources.forEach((source, index) => {
    const target = targets[index]
    if (!target) return
    target.width = source.width
    target.height = source.height
    target.getContext("2d")?.drawImage(source, 0, 0)
  })
  return clone
}

function paintedBackground(start: Element) {
  let current: Element | null = start
  while (current) {
    const color = getComputedStyle(current).backgroundColor
    if (color !== "" && color !== "transparent" && color !== "rgba(0, 0, 0, 0)") return color
    current = current.parentElement
  }
  return getComputedStyle(document.body).backgroundColor
}

function splitAtom(node: HTMLElement, maxHeight: number): HTMLElement[] {
  const height = node.getBoundingClientRect().height
  const children = [...node.children].filter((child): child is HTMLElement =>
    child instanceof HTMLElement && child.getBoundingClientRect().height >= 1)
  if (height <= maxHeight || children.length === 0) return [node]
  if (children.length === 1 && children[0].getBoundingClientRect().height >= height - 1) {
    return splitAtom(children[0], maxHeight)
  }
  if (!stacksVertically(node, children)) return [node]
  return children.flatMap((child) => splitAtom(child, maxHeight))
}

function stacksVertically(node: HTMLElement, children: HTMLElement[]) {
  const parentHeight = node.getBoundingClientRect().height
  const stacked = children.reduce((sum, child) => sum + child.getBoundingClientRect().height, 0)
  if (stacked > parentHeight * 1.2) return false
  const style = getComputedStyle(node)
  if (style.display === "flex" && (style.flexDirection === "row" || style.flexDirection === "row-reverse")) {
    return false
  }
  return true
}

function pathFrom(root: HTMLElement, node: HTMLElement) {
  const path: number[] = []
  let current: HTMLElement | null = node
  while (current && current !== root) {
    const parent: HTMLElement | null = current.parentElement
    if (!parent) break
    path.unshift([...parent.children].indexOf(current))
    current = parent
  }
  return path
}

function nodeAt(root: HTMLElement, path: readonly number[]) {
  return path.reduce<HTMLElement | null>((current, index) => {
    const child = current?.children[index]
    return child instanceof HTMLElement ? child : null
  }, root)
}

function replyColumnWidth(roots: readonly HTMLElement[]) {
  const column = roots[0]?.parentElement
  return Math.ceil(column?.clientWidth || roots[0].getBoundingClientRect().width)
}

function measureReplyPage(
  roots: readonly HTMLElement[],
  atoms: readonly ReplyAtom[],
  page: readonly ReplyAtom[],
  columnWidth: number
) {
  const stage = mountReplyPage(roots, atoms, page, columnWidth, "rgb(255 255 255)")
  try {
    return stage.getBoundingClientRect().height
  } finally {
    stage.parentElement?.remove()
  }
}

function mountReplyPage(
  roots: readonly HTMLElement[],
  atoms: readonly ReplyAtom[],
  page: readonly ReplyAtom[],
  columnWidth: number,
  background: string
) {
  const stage = createReplyStage(columnWidth, background)
  copyStageText(stage, roots[0]?.parentElement ?? document.body)
  const keep = new Set(page)
  roots.forEach((root, rootIndex) => {
    const inRoot = atoms.filter((atom) => atom.rootIndex === rootIndex)
    if (!inRoot.some((atom) => keep.has(atom))) return
    const clone = cloneReplyNode(root)
    stage.append(clone)
    const removed = inRoot.flatMap((atom) => {
      if (keep.has(atom)) return []
      const target = nodeAt(clone, atom.path)
      return target ? [target] : []
    })
    for (const target of removed) target.remove()
  })
  document.body.append(stage.parentElement ?? stage)
  return stage
}

async function renderReplyPdf(roots: HTMLElement[]) {
  const background = opaqueColor(paintedBackground(roots[0]?.parentElement ?? document.body))
  const { columnWidth, atoms, pages } = layoutReplyPages(roots)
  if (atoms.length === 0) throw new Error("empty reply")
  const shots: Blob[] = []
  for (const [start, end] of pages) {
    const stage = mountReplyPage(roots, atoms, atoms.slice(start, end), columnWidth, background)
    try {
      shots.push((await captureStage(stage)).blob)
    } finally {
      stage.parentElement?.remove()
    }
  }
  return imagesToPdf(shots, background)
}

async function imagesToPdf(shots: Blob[], background: string) {
  const { jsPDF } = await import("jspdf")
  const pdf = new jsPDF({ unit: "pt", format: "a4" })
  const [red, green, blue] = fillRgb(background)
  const contentWidth = A4_WIDTH - A4_MARGIN * 2
  const contentHeight = A4_HEIGHT - A4_MARGIN * 2
  for (let index = 0; index < shots.length; index += 1) {
    if (index > 0) pdf.addPage()
    pdf.setFillColor(red, green, blue)
    pdf.rect(0, 0, A4_WIDTH, A4_HEIGHT, "F")
    const url = URL.createObjectURL(shots[index])
    try {
      const image = await loadImage(url)
      let drawWidth = contentWidth
      let drawHeight = image.naturalHeight * (drawWidth / image.naturalWidth)
      if (drawHeight > contentHeight) {
        drawWidth *= contentHeight / drawHeight
        drawHeight = contentHeight
      }
      pdf.addImage(image, "PNG", A4_MARGIN, A4_MARGIN, drawWidth, drawHeight)
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  return pdf.output("blob")
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("reply image"))
    image.src = src
  })
}

function opaqueColor(color: string) {
  const [red, green, blue] = fillRgb(color)
  return `rgb(${red} ${green} ${blue})`
}

function fillRgb(color: string): [number, number, number] {
  const probe = document.createElement("canvas")
  probe.width = 1
  probe.height = 1
  const context = probe.getContext("2d")
  if (!context) return [255, 255, 255]
  context.fillStyle = "#ffffff"
  context.fillStyle = color
  const normalized = context.fillStyle
  if (!normalized.startsWith("#") || normalized.length !== 7) return [255, 255, 255]
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ]
}
