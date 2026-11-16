import assert from "node:assert/strict"
import test from "node:test"
import { connectWhiteboard, whiteboardSocketUrl } from "../../../src/features/whiteboard/whiteboard-connection"
import type { Board } from "../../../src/features/whiteboard/whiteboard-model"
class Socket extends EventTarget {
  readyState = 1
  sent: Record<string, unknown>[] = []
  send(data: string) { this.sent.push(JSON.parse(data)) }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")) }
  message(data: unknown) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) })) }
}
const original: Board = { v: 1, title: "Board", revision: 0, order: ["table"], elements: { table: { type: "table", x: 0, y: 0, w: 300, h: 100, columns: ["a", "b"], rows: [["one", "two"]] } } }
function fixture() {
  const socket = new Socket(), boards: Board[] = [], errors: (string | null)[] = [], cues: object[] = [], pending: number[] = []
  const client = connectWhiteboard("/workspace/.whiteboard/session-a/test.board.json", { board(board, cue) { boards.push(board); cues.push(cue) }, status() {}, claims() {}, pending(count) { pending.push(count) }, error(message) { errors.push(message) } }, () => socket, "https://example.test")
  socket.message({ type: "snapshot", board: original })
  return { socket, client, boards, errors, cues, pending }
}
test("WS URLs preserve Unicode paths and select secure protocol", () => {
  const url = new URL(whiteboardSocketUrl("/工作区/.whiteboard/session-a/方案.board.json", "https://example.test"))
  assert.equal(url.protocol, "wss:")
  assert.equal(url.searchParams.get("path"), "/工作区/.whiteboard/session-a/方案.board.json")
})
test("pending edits project on new server snapshots without losing the second edit", () => {
  const { socket, client, boards, pending } = fixture()
  try {
    client.write([{ op: "update", id: "table", patch: { rows: [["changed", "two"]] } }])
    assert.deepEqual((boards.at(-1)!.elements.table as { rows: string[][] }).rows, [["changed", "two"]])
    client.write([{ op: "update", id: "table", patch: { rows: [["changed", "also changed"]] } }])
    socket.message({ type: "change", revision: 1, title: "Board", source: "user", ops: [{ op: "update", id: "table", patch: { rows: [["changed", "two"]] } }] })
    socket.message({ type: "ack", requestId: "edit-1", revision: 1 })
    assert.deepEqual((boards.at(-1)!.elements.table as { rows: string[][] }).rows, [["changed", "also changed"]])
    assert.equal(pending.at(-1), 1)
  } finally { client.dispose() }
})
test("rejected write rolls back optimistic changes and reports the error", () => {
  const { socket, client, boards, errors } = fixture()
  try {
    client.write([{ op: "update", id: "table", patch: { x: 99 } }])
    socket.message({ type: "error", requestId: "edit-1", message: "Rejected" })
    assert.equal((boards.at(-1)!.elements.table as { x: number }).x, 0)
    assert.equal(errors.at(-1), "Rejected")
  } finally { client.dispose() }
})
test("dispose prevents stale socket snapshots and disables writes", () => {
  const { socket, client, boards } = fixture()
  client.dispose()
  socket.message({ type: "snapshot", board: { ...original, title: "stale" } })
  assert.equal(boards.length, 1)
  assert.equal(client.write([]), false)
})
