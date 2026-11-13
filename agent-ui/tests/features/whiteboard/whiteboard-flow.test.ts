import assert from "node:assert/strict"
import test from "node:test"
import { boardFlowElements, committedPositionOperations } from "../../../src/features/whiteboard/whiteboard-flow"
import type { Board } from "../../../src/features/whiteboard/whiteboard-model"
const board: Board = { v: 1, revision: 0, title: "Test", order: ["a", "edge"], elements: { a: { type: "shape", kind: "rect", x: 0, y: 0, w: 100, h: 60 }, edge: { type: "arrow", from: "a", to: { x: 200, y: 50 } } } }
test("keyboard moves persist, intermediate drags and resizes do not write", () => {
  assert.deepEqual(committedPositionOperations([{ type: "position", id: "a", position: { x: 5, y: 0 }, dragging: false }], board), [{ op: "update", id: "a", patch: { x: 5, y: 0 } }])
  assert.deepEqual(committedPositionOperations([{ type: "position", id: "a", position: { x: 5, y: 0 }, dragging: true }], board), [])
  assert.deepEqual(committedPositionOperations([{ type: "position", id: "a", position: { x: 5, y: 0 } }], board), [])
})
test("free endpoints are invisible non-editable anchors and bound endpoints stay on the actual node", () => {
  const result = boardFlowElements(board)
  assert.equal(result.edges[0].source, "a")
  const anchor = result.nodes.find(node => node.id === result.edges[0].target)!
  assert.deepEqual(anchor.position, { x: 200, y: 50 })
  assert.equal(anchor.draggable, false)
  assert.equal(anchor.selectable, false)
  assert.equal(anchor.deletable, false)
})
