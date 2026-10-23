import { EASE_OUT } from "@/lib/ease"

const nativeBorderSelector = "[data-xlsx-selection-border], [data-xlsx-active-cell-border]"
const selectionSelector = "[data-xlsx-selection-fill]"
const selectionNodeSelector = `${selectionSelector}, ${nativeBorderSelector}`
const geometryAttributes = ["d", "x", "y", "width", "height"]
const svgNamespace = "http://www.w3.org/2000/svg"

type Segment = { x1: number; y1: number; x2: number; y2: number }
type Decoration = { signature: string; nodes: SVGElement[] }
type Bounds = { x: number; y: number; width: number; height: number }
type Transition = { context: number | string; from: Bounds; to: Bounds; nodes: SVGElement[]; animations: Animation[] }

function borderSegments(border: SVGElement): Segment[] {
  if (border.localName !== "path") return []
  const data = border.getAttribute("d") ?? ""
  const number = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?"
  const pattern = new RegExp(`M\\s*(${number})[\\s,]+(${number})\\s*([HV])\\s*(${number})`, "g")
  const segments: Segment[] = []
  for (const match of data.matchAll(pattern)) {
    const x1 = Number(match[1])
    const y1 = Number(match[2])
    const end = Number(match[4])
    segments.push({ x1, y1, x2: match[3] === "H" ? end : x1, y2: match[3] === "V" ? end : y1 })
  }
  return data.replace(pattern, "").trim() ? [] : segments
}

function rectangleBounds(border: SVGElement): Bounds | null {
  const segments = borderSegments(border)
  if (segments.length !== 4) return null
  const xs = segments.flatMap(({ x1, x2 }) => [x1, x2])
  const ys = segments.flatMap(({ y1, y2 }) => [y1, y2])
  const x = Math.min(...xs), y = Math.min(...ys)
  const right = Math.max(...xs), bottom = Math.max(...ys)
  const horizontal = segments.filter((line) => line.y1 === line.y2 &&
    Math.min(line.x1, line.x2) === x && Math.max(line.x1, line.x2) === right)
  const vertical = segments.filter((line) => line.x1 === line.x2 &&
    Math.min(line.y1, line.y2) === y && Math.max(line.y1, line.y2) === bottom)
  return right > x && bottom > y && horizontal.length === 2 && vertical.length === 2 &&
    horizontal.some((line) => line.y1 === y) && horizontal.some((line) => line.y1 === bottom) &&
    vertical.some((line) => line.x1 === x) && vertical.some((line) => line.x1 === right)
    ? { x, y, width: right - x, height: bottom - y } : null
}

function selectionCorners(border: SVGElement) {
  // Only the native perimeter path distinguishes real edges from viewport and
  // frozen-pane cuts. The multi-area active-cell rect is already clipped.
  const segments = borderSegments(border)
  if (!segments.length) return ""
  const xs = segments.flatMap(({ x1, x2 }) => [x1, x2])
  const ys = segments.flatMap(({ y1, y2 }) => [y1, y2])
  if (Math.max(...xs) - Math.min(...xs) < 48 || Math.max(...ys) - Math.min(...ys) < 48) return ""

  const horizontal = segments.filter(({ x1, x2 }) => Math.abs(x2 - x1) >= 12)
  const vertical = segments.filter(({ y1, y2 }) => Math.abs(y2 - y1) >= 12)
  const corners = new Set<string>()
  for (const h of horizontal) for (const v of vertical) {
    const x = v.x1
    const y = h.y1
    if (!(x === h.x1 || x === h.x2) || !(y === v.y1 || y === v.y2)) continue
    const endX = x + Math.sign((h.x1 + h.x2) / 2 - x) * 6
    const endY = y + Math.sign((v.y1 + v.y2) / 2 - y) * 6
    corners.add(`M${endX} ${y}H${x}V${endY}`)
  }
  return [...corners].join("")
}

function strokeDecoration(border: SVGElement, attribute: string) {
  const clone = border.cloneNode(false) as SVGElement
  clone.removeAttribute("data-xlsx-selection-border")
  clone.removeAttribute("data-xlsx-active-cell-border")
  clone.setAttribute(attribute, "")
  clone.setAttribute("aria-hidden", "true")
  clone.setAttribute("focusable", "false")
  clone.style.setProperty("--xlsx-selection-stroke-width", `${Number(border.getAttribute("stroke-width")) || 2}px`)
  return clone
}

function containsSelection(node: Node) {
  if (node.nodeType !== 1) return false
  const element = node as Element
  return element.matches(selectionNodeSelector) || Boolean(element.querySelector(selectionNodeSelector))
}

export function decorateXlsxSelection(container: HTMLElement, options: {
  animate: () => boolean
  context: () => number | string
}): () => void {
  const cache = new WeakMap<SVGElement, Decoration>()
  const decorations = new Set<SVGElement>()
  let transition: Transition | null = null

  const cancelTransition = () => {
    for (const animation of transition?.animations ?? []) animation.cancel()
  }

  const moveSelection = (borders: SVGElement[]) => {
    const border = borders.length === 1 && borders[0].hasAttribute("data-xlsx-selection-border") ? borders[0] : null
    // Partial or split perimeters must keep the native clipping exactly aligned.
    const to = border && rectangleBounds(border)
    const context = options.context()
    const previous = transition
    if (!to || !border) {
      cancelTransition()
      transition = null
      return
    }
    const nodes = [border, ...(cache.get(border)?.nodes ?? [])]
    const animate = options.animate() && previous !== null && previous.context === context
    if (animate && previous.nodes.length === nodes.length && previous.nodes.every((node, index) => node === nodes[index]) &&
      Object.keys(to).every((key) => to[key as keyof Bounds] === previous.to[key as keyof Bounds])) return
    const animation = previous?.animations[0]
    const progress = animation ? animation.effect?.getComputedTiming().progress ?? (animation.playState === "finished" ? 1 : 0) : 1
    const from = previous && animate ? {
      x: previous.from.x + (previous.to.x - previous.from.x) * progress,
      y: previous.from.y + (previous.to.y - previous.from.y) * progress,
      width: previous.from.width + (previous.to.width - previous.from.width) * progress,
      height: previous.from.height + (previous.to.height - previous.from.height) * progress,
    } : to
    cancelTransition()
    transition = { context, from, to, nodes, animations: [] }
    if (!animate || from.x === to.x && from.y === to.y && from.width === to.width && from.height === to.height) return
    const scaleX = from.width / to.width, scaleY = from.height / to.height
    const transform = `translate(${from.x - to.x * scaleX}px, ${from.y - to.y * scaleY}px) scale(${scaleX}, ${scaleY})`
    transition.animations = nodes.map((node) => node.animate([
      { transform, transformOrigin: "0 0", transformBox: "view-box" },
      { transform: "translate(0px, 0px) scale(1, 1)", transformOrigin: "0 0", transformBox: "view-box" },
    ], { duration: 120, easing: `cubic-bezier(${EASE_OUT.join(",")})` }))
  }

  const refresh = () => {
    for (const node of decorations) {
      if (!container.contains(node)) decorations.delete(node)
    }
    const borders = [...container.querySelectorAll<SVGElement>(nativeBorderSelector)]
      .filter((border) => border.closest(selectionSelector))
    for (const border of borders) {
      const signature = [border.localName, ...geometryAttributes.map((name) => border.getAttribute(name)),
        border.getAttribute("stroke-width")].join("|")
      const previous = cache.get(border)
      if (previous?.signature === signature && previous.nodes.every((node) => node.parentNode === border.parentNode)) continue
      for (const node of previous?.nodes ?? []) {
        node.remove()
        decorations.delete(node)
      }

      const glow = strokeDecoration(border, "data-xlsx-selection-glow")
      const isolation = strokeDecoration(border, "data-xlsx-selection-isolation")
      border.before(glow, isolation)
      const nodes = [glow, isolation]
      const cornerPath = selectionCorners(border)
      if (cornerPath) {
        const corners = container.ownerDocument.createElementNS(svgNamespace, "path")
        corners.setAttribute("data-xlsx-selection-corners", "")
        corners.setAttribute("d", cornerPath)
        corners.setAttribute("fill", "none")
        corners.setAttribute("aria-hidden", "true")
        corners.setAttribute("focusable", "false")
        border.after(corners)
        nodes.push(corners)
      }
      for (const node of nodes) decorations.add(node)
      cache.set(border, { signature, nodes })
    }
    moveSelection(borders)
  }

  const observer = new MutationObserver((mutations) => {
    const changed = mutations.some((mutation) => mutation.type === "attributes"
      ? (mutation.target as Element).matches(nativeBorderSelector) && Boolean((mutation.target as Element).closest(selectionSelector))
      : [...mutation.addedNodes, ...mutation.removedNodes].some(containsSelection))
    if (changed && transition?.context !== options.context()) {
      cancelTransition()
      transition = null
    }
    if (changed) refresh()
  })
  observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: geometryAttributes })
  refresh()

  return () => {
    observer.disconnect()
    cancelTransition()
    for (const node of decorations) node.remove()
    decorations.clear()
  }
}
