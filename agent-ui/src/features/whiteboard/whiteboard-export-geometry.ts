export type WhiteboardExportRect = { x: number; y: number; width: number; height: number }

export function whiteboardExportLayout(rectangles: WhiteboardExportRect[]) {
  if (!rectangles.length) throw new Error("The whiteboard is empty.")
  const left = Math.min(...rectangles.map(rect => rect.x))
  const top = Math.min(...rectangles.map(rect => rect.y))
  const right = Math.max(...rectangles.map(rect => rect.x + rect.width))
  const bottom = Math.max(...rectangles.map(rect => rect.y + rect.height))
  if (![left, top, right, bottom].every(Number.isFinite) || right < left || bottom < top) throw new Error("The whiteboard has invalid element bounds.")
  const padding = 32
  const width = Math.max(1, Math.ceil(right - left + padding * 2))
  const height = Math.max(1, Math.ceil(bottom - top + padding * 2))
  const scale = Math.min(2, 8192 / width, 8192 / height, Math.sqrt(32_000_000 / (width * height)))
  if (Math.floor(width * scale) < 1 || Math.floor(height * scale) < 1) throw new Error("The whiteboard is too wide or tall to export as an image.")
  return { width, height, scale, x: padding - left, y: padding - top, bounds: { x: left, y: top, width: right - left, height: bottom - top } }
}

/** jsPDF clamps oversized pages, so scale both axes before constructing a page. */
export function whiteboardPdfPage(width: number, height: number) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error("Invalid whiteboard export dimensions.")
  const scale = Math.min(.75, 14400 / width, 14400 / height)
  return { width: width * scale, height: height * scale, orientation: width > height ? "landscape" as const : "portrait" as const }
}
