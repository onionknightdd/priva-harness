import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  FILE_TREE_ROW_HEIGHT,
  FILE_TREE_ROW_PITCH,
  fileTreeRevealOffset,
  fileTreeToggle,
  flattenFileTree,
  pinnedFileTreeRows,
} from "../../../src/features/file-browser/file-tree-rows.ts"

type Node = { id: string; open?: boolean; children?: Node[] }

const accessors = {
  isFolder: (node: Node) => node.children !== undefined,
  isExpanded: (node: Node) => node.open === true,
  getChildren: (node: Node) => node.children ?? [],
}
const files = (prefix: string, count: number): Node[] =>
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}` }))

// root            0
//   src           1   (open)
//     nested      2   (open)
//       n0..n3    3-6
//     closed      7   (folder, closed, with children)
//     empty       8   (folder, open, no children)
//     s0..s2      9-11
//   docs          12  (closed)
//   r0..r29       13-42
const tree: Node[] = [{
  id: "root", open: true, children: [
    { id: "src", open: true, children: [
      { id: "nested", open: true, children: files("n", 4) },
      { id: "closed", children: files("c", 3) },
      { id: "empty", open: true, children: [] },
      ...files("s", 3),
    ] },
    { id: "docs", children: files("d", 2) },
    ...files("r", 30),
  ],
}]
const rows = flattenFileTree(tree, accessors)
const index = (id: string) => rows.findIndex((row) => row.node.id === id)
const top = (id: string) => index(id) * FILE_TREE_ROW_PITCH
const pinnedIds = (offset: number) => pinnedFileTreeRows(rows, offset).map((entry) => [rows[entry.index].node.id, entry.shift])

describe("flattenFileTree", () => {
  it("lists only rows under open folders, in display order", () => {
    assert.deepEqual(rows.slice(0, 13).map((row) => row.node.id),
      ["root", "src", "nested", "n0", "n1", "n2", "n3", "closed", "empty", "s0", "s1", "s2", "docs"])
    assert.equal(rows.length, 43)
  })

  it("records level, sibling position, parent and subtree extent", () => {
    const pick = (id: string) => { const { level, positionInSet, setSize, parent, subtreeEnd, canStick } = rows[index(id)]; return { level, positionInSet, setSize, parent, subtreeEnd, canStick } }
    assert.deepEqual(pick("root"), { level: 0, positionInSet: 1, setSize: 1, parent: -1, subtreeEnd: 42, canStick: true })
    assert.deepEqual(pick("src"), { level: 1, positionInSet: 1, setSize: 32, parent: 0, subtreeEnd: 11, canStick: true })
    assert.deepEqual(pick("n3"), { level: 3, positionInSet: 4, setSize: 4, parent: 2, subtreeEnd: 6, canStick: false })
    assert.deepEqual(pick("closed"), { level: 2, positionInSet: 2, setSize: 6, parent: 1, subtreeEnd: 7, canStick: false })
    assert.deepEqual(pick("empty"), { level: 2, positionInSet: 3, setSize: 6, parent: 1, subtreeEnd: 8, canStick: false })
    assert.deepEqual(pick("docs"), { level: 1, positionInSet: 2, setSize: 32, parent: 0, subtreeEnd: 12, canStick: false })
  })
})

describe("pinnedFileTreeRows", () => {
  it("pins nothing before the list has scrolled", () => {
    assert.deepEqual(pinnedIds(0), [])
    assert.deepEqual(pinnedIds(-40), [])
    assert.deepEqual(pinnedFileTreeRows([], 100), [])
  })

  it("pins each open ancestor once its own row has passed its slot", () => {
    assert.deepEqual(pinnedIds(1), [["root", 0]])
    // src rests at 27 and owns the slot at offset + 26.
    assert.deepEqual(pinnedIds(2), [["root", 0], ["src", 0]])
    assert.deepEqual(pinnedIds(top("n1")), [["root", 0], ["src", 0], ["nested", 0]])
  })

  it("never pins closed or empty folders, nor files", () => {
    // The slot rows are `closed`, then `empty`: neither can be held.
    const offset = top("closed") - 2 * FILE_TREE_ROW_HEIGHT + 4
    assert.deepEqual(pinnedIds(offset).map(([id]) => id), ["root", "src"])
    assert.deepEqual(pinnedIds(top("r10")).map(([id]) => id), ["root"])
  })

  it("pushes a folder out with the last row of its subtree", () => {
    const nestedBottom = (index("n3") + 1) * FILE_TREE_ROW_PITCH - 1
    const slot = (offset: number) => offset + 2 * FILE_TREE_ROW_HEIGHT
    const resting = nestedBottom - FILE_TREE_ROW_HEIGHT - 2 * FILE_TREE_ROW_HEIGHT
    assert.deepEqual(pinnedIds(resting).at(-1), ["nested", 0])
    const pushed = pinnedIds(resting + 10).find(([id]) => id === "nested")
    assert.deepEqual(pushed, ["nested", -10])
    assert.equal(slot(resting + 10) + -10 + FILE_TREE_ROW_HEIGHT, nestedBottom, "Its bottom edge follows the subtree's last row")
    // Once the subtree has left the slot the folder is released.
    assert.equal(pinnedIds(nestedBottom - 2 * FILE_TREE_ROW_HEIGHT + 1).some(([id]) => id === "nested"), false)
  })

  it("keeps the root pinned to the end of the list", () => {
    const end = rows.length * FILE_TREE_ROW_PITCH - 1
    assert.deepEqual(pinnedIds(end - 200), [["root", 0]])
    assert.deepEqual(pinnedIds(end - 10), [["root", -16]])
  })
})

describe("fileTreeRevealOffset", () => {
  const viewport = 400
  const row = (id: string) => ({ index: index(id), level: rows[index(id)].level })

  it("leaves a visible row where it is", () => {
    assert.equal(fileTreeRevealOffset(row("s1"), 0, viewport), null)
    assert.equal(fileTreeRevealOffset(row("r5"), top("r5") - 100, viewport), null)
  })

  it("scrolls up far enough to clear the ancestors pinned above the row", () => {
    // n0 is at level 3: three pinned ancestors cover the top 78px.
    assert.equal(fileTreeRevealOffset(row("n0"), top("n0") - 20, viewport), top("n0") - 3 * FILE_TREE_ROW_HEIGHT)
    assert.equal(fileTreeRevealOffset(row("root"), 500, viewport), 0)
    assert.equal(fileTreeRevealOffset(row("src"), 500, viewport), 1)
  })

  it("scrolls down just far enough to show the whole row", () => {
    assert.equal(fileTreeRevealOffset(row("r20"), 0, viewport), top("r20") + FILE_TREE_ROW_HEIGHT - viewport)
  })
})

describe("fileTreeToggle", () => {
  const list = (nodes: Node[]) => flattenFileTree(nodes, accessors)
  const id = (node: Node) => node.id
  const withSrc = (open: boolean, children = files("s", 3)): Node[] => [{
    id: "root", open: true, children: [{ id: "src", open, children }, { id: "docs", children: [] }, ...files("r", 2)],
  }]

  it("reports the block a folder reveals or hides", () => {
    assert.deepEqual(fileTreeToggle(list(withSrc(false)), list(withSrc(true)), id), { kind: "open", first: 2, count: 3 })
    assert.deepEqual(fileTreeToggle(list(withSrc(true)), list(withSrc(false)), id), { kind: "close", first: 2, count: 3 })
  })

  it("covers a listing that arrives under an already open folder and a block at the end", () => {
    assert.deepEqual(fileTreeToggle(list(withSrc(true, [])), list(withSrc(true)), id), { kind: "open", first: 2, count: 3 })
    const tail = (open: boolean): Node[] => [{ id: "root", open: true, children: [{ id: "last", open, children: files("t", 2) }] }]
    assert.deepEqual(fileTreeToggle(list(tail(true)), list(tail(false)), id), { kind: "close", first: 2, count: 2 })
  })

  it("ignores changes that are not one contiguous block", () => {
    const same = list(withSrc(true))
    assert.equal(fileTreeToggle(same, list(withSrc(true)), id), null)
    assert.equal(fileTreeToggle(list(withSrc(true)), list(withSrc(true, files("x", 3))), id), null, "Same length, different rows")
    const scattered: Node[] = [{ id: "root", open: true, children: [{ id: "src", open: true, children: files("s", 3) }, { id: "docs", open: true, children: files("d", 2) }, ...files("r", 2)] }]
    assert.equal(fileTreeToggle(list(withSrc(false)), list(scattered), id), null, "Two folders opened at once")
  })
})
