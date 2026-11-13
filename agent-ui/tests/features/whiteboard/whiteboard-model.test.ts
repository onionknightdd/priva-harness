import assert from "node:assert/strict"
import test from "node:test"
import { applyBoardChange, boardLayoutIssues, createdElementCues, parentFirstIds, type Board, type BoardElement } from "../../../src/features/whiteboard/whiteboard-model"
import { shapePaths } from "../../../src/features/whiteboard/whiteboard-shapes"
const box: BoardElement = { type: "shape", kind: "database", x: 0, y: 0, w: 100, h: 60 }
const base: Board = { v: 1, title: "Test", revision: 1, order: ["a"], elements: { a: box } }

test("element patches preserve other fields and reject revision gaps", () => {
  const next = applyBoardChange(base, 2, [{ op: "update", id: "a", patch: { text: "Changed" } }], "New")
  assert.equal(next.elements.a.type, "shape")
  assert.equal((next.elements.a as typeof box).w, 100)
  assert.equal((base.elements.a as typeof box).text, undefined)
  assert.throws(() => applyBoardChange(base, 3, [], "Test"), /revision gap/)
})
test("canonical delta stacking order and deletion are authoritative", () => {
  const next = applyBoardChange(base, 2, [{ op: "set", id: "b", element: box }, { op: "set", id: "a", element: box }], "Test", ["b", "a"])
  assert.deepEqual(next.order, ["b", "a"])
  assert.deepEqual(applyBoardChange(next, 3, [{ op: "delete", id: "b" }], "Test").order, ["a"])
})
test("only newly created agent elements receive drawing cues", () => {
  const ops = [{ op: "set" as const, id: "a", element: box }, { op: "set" as const, id: "new", element: box }]
  assert.deepEqual(createdElementCues(base, ops, 2, "agent"), { new: { revision: 2, delay: 0 } })
  assert.deepEqual(createdElementCues(base, ops, 2, "user"), {})
})
test("containers are rendered before children and intentional containment is not overlap", () => {
  const board: Board = { ...base, order: ["child", "parent"], elements: { child: { ...box, x: 10, y: 10, parentId: "parent" }, parent: { type: "container", x: 0, y: 0, w: 300, h: 200 } } }
  assert.deepEqual(parentFirstIds(board), ["parent", "child"])
  assert.deepEqual(boardLayoutIssues(board), [])
  board.elements.child = { ...box, parentId: "parent", x: 290 }
  assert.match(boardLayoutIssues(board)[0], /extends outside/)
})
test("database and queue have complete closed ellipse cap paths", () => {
  for (const kind of ["database", "queue"] as const) {
    const [body, cap] = shapePaths(kind, 100, 60)
    assert.match(body, /Z$/)
    assert.match(cap!, /Z$/)
    assert.equal(cap!.split("A").length - 1, 2)
  }
  assert.equal(shapePaths("rect", 100, 60)[1], undefined)
})
