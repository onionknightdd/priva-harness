import type { ModelAnchor, ModelFileAnnotation, ModelVector3 } from "@/features/agent-message/file-annotation"

export type ModelUnits = ModelFileAnnotation["units"]
export const METERS_PER_UNIT = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048, model: 1 }

export function distanceBetween(a: ModelVector3, b: ModelVector3) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/** The middle anchor is the vertex. Degenerate measurements have no angle. */
export function angleBetween(a: ModelVector3, vertex: ModelVector3, b: ModelVector3): number | null {
  const length = distanceBetween(a, vertex) * distanceBetween(b, vertex)
  if (!length) return null
  const dot = (a[0] - vertex[0]) * (b[0] - vertex[0]) + (a[1] - vertex[1]) * (b[1] - vertex[1]) + (a[2] - vertex[2]) * (b[2] - vertex[2])
  return Math.acos(Math.max(-1, Math.min(1, dot / length))) * 180 / Math.PI
}

export function displayDistance(distance: number, units: ModelUnits) {
  return units.metersPerUnit === null || units.displayUnit === "model"
    ? distance
    : distance * units.metersPerUnit / METERS_PER_UNIT[units.displayUnit]
}

export function measurementValue(anchors: ModelAnchor[], kind: "distance" | "angle") {
  if (kind === "distance" && anchors.length === 2) return distanceBetween(anchors[0].position, anchors[1].position)
  if (kind === "angle" && anchors.length === 3) return angleBetween(anchors[0].position, anchors[1].position, anchors[2].position)
  return null
}
