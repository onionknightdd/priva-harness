import { curveCatmullRom, line } from "d3-shape"
import type { ShapeKind } from "./whiteboard-model"

function rounded(w: number, h: number, radius: number) {
  const r = Math.min(radius, w / 2, h / 2)
  return `M${r},0H${w-r}A${r},${r} 0 0 1 ${w},${r}V${h-r}A${r},${r} 0 0 1 ${w-r},${h}H${r}A${r},${r} 0 0 1 0,${h-r}V${r}A${r},${r} 0 0 1 ${r},0Z`
}

/** The second path is a persistent end-cap edge, independent of the transient drawing outline. */
export function shapePaths(kind: ShapeKind, w: number, h: number): [string, string?] {
  switch (kind) {
    case "rect": return [rounded(w, h, 2)]
    case "rounded": return [rounded(w, h, 8)]
    case "pill": return [rounded(w, h, h / 2)]
    case "ellipse": return [`M0,${h/2}A${w/2},${h/2} 0 1 1 ${w},${h/2}A${w/2},${h/2} 0 1 1 0,${h/2}Z`]
    case "diamond": return [`M${w/2},0L${w},${h/2}L${w/2},${h}L0,${h/2}Z`]
    case "hexagon": { const d = Math.min(w * .2, h / 2); return [`M${d},0H${w-d}L${w},${h/2}L${w-d},${h}H${d}L0,${h/2}Z`] }
    case "parallelogram": { const s = w * .18; return [`M${s},0H${w}L${w-s},${h}H0Z`] }
    case "database": { const r = h * .15; return [`M0,${r}A${w/2},${r} 0 0 1 ${w},${r}V${h-r}A${w/2},${r} 0 0 1 0,${h-r}Z`, `M0,${r}A${w/2},${r} 0 0 1 ${w},${r}A${w/2},${r} 0 0 1 0,${r}Z`] }
    case "queue": { const r = w * .1; return [`M${r},0H${w-r}A${r},${h/2} 0 0 1 ${w-r},${h}H${r}A${r},${h/2} 0 0 1 ${r},0Z`, `M${w-r},0A${r},${h/2} 0 0 1 ${w-r},${h}A${r},${h/2} 0 0 1 ${w-r},0Z`] }
    case "document": { const k = h * .14; return [`M0,0H${w}V${h-k}Q${w*.75},${h-2.2*k} ${w/2},${h-k}T0,${h-k}Z`] }
    case "cloud": return [`M${.25*w},${.86*h}H${.75*w}A${.2*w},${.25*h} 0 0 0 ${.8*w},${.38*h}A${.22*w},${.3*h} 0 0 0 ${.42*w},${.22*h}A${.18*w},${.24*h} 0 0 0 ${.2*w},${.45*h}A${.16*w},${.2*h} 0 0 0 ${.25*w},${.86*h}Z`]
    case "person": { const r=h*.2,cx=w/2,cy=h*.23; return [`M${cx-r},${cy}a${r},${r} 0 1 0 ${2*r},0a${r},${r} 0 1 0 ${-2*r},0Z M${.16*w},${h}A${.34*w},${.5*h} 0 0 1 ${.84*w},${h}Z`] }
  }
}

const freehandLine = line<[number, number]>().curve(curveCatmullRom.alpha(.5))

export function strokePath(points: [number, number][]) {
  // Repeated pointer samples should not introduce zero-length spline segments.
  const distinct = points.filter((point, index) => index === 0 || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1])
  return freehandLine(distinct) ?? ""
}
