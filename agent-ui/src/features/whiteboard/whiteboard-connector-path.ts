import { getSmoothStepPath, Position } from "@xyflow/react"
import rough from "roughjs"

const pen = rough.generator()
type Connector = { id: string; sourceX: number; sourceY: number; targetX: number; targetY: number; sourcePosition: Position; targetPosition: Position }

function seedFor(id: string) {
  let seed = 2166136261
  for (const char of id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619)
  return (seed >>> 0) || 1
}

/** Keep the routed endpoints, with a stable pen character across edits and renders. */
export function handdrawnConnectorPath(input: Connector): [string, number, number] {
  const { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty, sourcePosition: from, targetPosition: to } = input
  const seed = seedFor(input.id)
  const dx = tx - sx, dy = ty - sy
  const horizontal = Math.abs(dy) < .01 && (dx > 0 && from === Position.Right && to === Position.Left || dx < 0 && from === Position.Left && to === Position.Right)
  const vertical = Math.abs(dx) < .01 && (dy > 0 && from === Position.Bottom && to === Position.Top || dy < 0 && from === Position.Top && to === Position.Bottom)
  let [route, labelX, labelY] = getSmoothStepPath({ ...input, borderRadius: 12, offset: from === to ? 56 : 20 })
  if (horizontal || vertical) {
    // A small arch prevents aligned ports from reverting to a ruler-straight line.
    const bend = Math.min(12, Math.hypot(dx, dy) * .08) * (seed % 2 ? 1 : -1)
    const bx = vertical ? bend : 0, by = horizontal ? bend : 0
    route = `M${sx},${sy}C${sx + dx / 3 + bx},${sy + dy / 3 + by} ${sx + dx * 2 / 3 + bx},${sy + dy * 2 / 3 + by} ${tx},${ty}`
    labelX = (sx + tx) / 2 + .75 * bx
    labelY = (sy + ty) / 2 + .75 * by
  }
  const drawing = pen.path(route, {
    seed, roughness: .7, bowing: 1, maxRandomnessOffset: 1.2,
    disableMultiStroke: true, preserveVertices: true,
  })
  const path = drawing.sets.map(set => {
    let x: number | undefined, y: number | undefined
    // Rough.js restarts each routed segment. Join matching vertices so the dash
    // animation follows the pen continuously instead of restarting at each bend.
    const ops = set.ops.filter(op => {
      if (op.op === "move" && op.data[0] === x && op.data[1] === y) return false
      x = op.data.at(-2); y = op.data.at(-1)
      return true
    })
    return pen.opsToPath({ ...set, ops }, 3)
  }).join(" ")
  return [path, labelX, labelY]
}
