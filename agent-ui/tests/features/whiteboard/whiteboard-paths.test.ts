import assert from "node:assert/strict"
import { test } from "node:test"
import { Position } from "@xyflow/react"
import { handdrawnConnectorPath } from "../../../src/features/whiteboard/whiteboard-connector-path.ts"
import { strokePath } from "../../../src/features/whiteboard/whiteboard-shapes.ts"

test("handwritten samples interpolate as curves instead of angular line segments", () => {
  const d = strokePath([[0, 30], [40, 0], [80, 55], [120, 10], [160, 30]])
  assert.ok(d.startsWith("M0,30"))
  assert.match(d, /C/)
  assert.doesNotMatch(d, /L/)
  assert.ok(d.endsWith("160,30"))
  assert.doesNotMatch(strokePath([[0, 0], [0, 0], [10, 4], [20, 0]]), /NaN|Infinity/)
  assert.equal(strokePath([[0, 0], [10, 10]]), "M0,0L10,10")
})

test("aligned connections retain a visible bow and deterministic handdrawn paths", () => {
  const input = { id: "select", sourceX: 206, sourceY: 220, targetX: 307, targetY: 220, sourcePosition: Position.Right, targetPosition: Position.Left }
  const result = handdrawnConnectorPath(input)
  assert.match(result[0], /C/)
  assert.notEqual(result[2], 220)
  assert.deepEqual(handdrawnConnectorPath(input), result, "re-renders must not randomize the ink")
  assert.notEqual(handdrawnConnectorPath({ ...input, id: "other" })[0], result[0])
  assert.doesNotMatch(result[0], /NaN|Infinity/)
})

test("return connections route below both bottom ports and retain the sample label position", () => {
  const [path, x, y] = handdrawnConnectorPath({ id: "return", sourceX: 633, sourceY: 270, targetX: 131, targetY: 264, sourcePosition: Position.Bottom, targetPosition: Position.Bottom })
  assert.equal(x, 382)
  assert.equal(y, 326)
  assert.match(path, /C/)
  assert.equal(path.match(/M/g)?.length, 1, "the route must trace continuously instead of restarting at each bend")
  assert.doesNotMatch(path, /NaN|Infinity/)
  assert.ok(path.includes("633 270"))
  assert.ok(path.endsWith("131 264"))
})
