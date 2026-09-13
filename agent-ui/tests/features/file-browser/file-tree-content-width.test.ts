import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  FILE_TREE_OVERFLOW_BUFFER_PX,
  createFileTreeNameMeasurer,
  fileTreeMaxNameOverflow,
  fileTreeTargetPanelWidth,
} from "../../../src/features/file-browser/file-tree-content-width.ts"

describe("fileTreeMaxNameOverflow", () => {
  it("returns zero when every name fits its slot", () => {
    assert.equal(
      fileTreeMaxNameOverflow([
        { nameWidth: 40, nameSlotWidth: 80 },
        { nameWidth: 72, nameSlotWidth: 72 },
      ]),
      0
    )
  })

  it("returns the largest clipped name width", () => {
    assert.equal(
      fileTreeMaxNameOverflow([
        { nameWidth: 90, nameSlotWidth: 80 },
        { nameWidth: 140, nameSlotWidth: 80 },
      ]),
      60
    )
  })
})

function measurementFixture() {
  const operations: string[] = []
  let scale = 10
  let connectedProbes = 0
  let connectedHosts = 0
  const ownerDocument = {
    defaultView: {
      getComputedStyle: (sample: { font: string }) => {
        operations.push("read:font")
        return { font: sample.font }
      },
    },
    createElement: (tagName: string) =>
      tagName === "div"
        ? {
            ariaHidden: "",
            style: { cssText: "" },
            appendChild: (fragment: { children: unknown[] }) => {
              connectedProbes += fragment.children.length
              operations.push("write:insert")
            },
            remove: () => {
              connectedHosts -= 1
              operations.push("write:remove-host")
            },
          }
        : {
            ariaHidden: "",
            style: { cssText: "", font: "" },
            textContent: "",
            get offsetWidth() {
              operations.push("read:probe")
              return this.textContent.length * scale * (this.style.font.startsWith("bold") ? 2 : 1)
            },
            remove: () => {
              connectedProbes -= 1
              operations.push("write:remove")
            },
          },
    createDocumentFragment: () => ({
      children: [] as unknown[],
      appendChild(node: unknown) { this.children.push(node) },
    }),
    body: {
      appendChild: () => {
        connectedHosts += 1
        operations.push("write:insert-host")
      },
    },
  } as unknown as Document
  const slot = (name: string, width: number, font = "14px Inter") => ({
    dataset: { fileTreeNameText: name },
    firstElementChild: { font },
    get clientWidth() {
      operations.push("read:slot")
      return width
    },
  }) as unknown as HTMLElement

  return {
    measurer: createFileTreeNameMeasurer(ownerDocument),
    operations,
    slot,
    connectedProbes: () => connectedProbes,
    connectedHosts: () => connectedHosts,
    setFontScale: (value: number) => { scale = value },
  }
}

describe("file tree name measurement", () => {
  it("batches all live reads, probe writes and measurements separately", () => {
    const { measurer, operations, slot, connectedProbes, connectedHosts } = measurementFixture()

    assert.equal(measurer.measure([slot("one", 20), slot("long-name", 40)]), 50)
    assert.deepEqual(operations, [
      "read:font", "read:slot", "read:font", "read:slot",
      "write:insert-host", "write:insert", "read:probe", "read:probe",
      "write:remove", "write:remove",
    ])
    assert.equal(connectedProbes(), 0)
    assert.equal(connectedHosts(), 1)
  })

  it("keeps one contained probe host until disposed", () => {
    const { measurer, operations, slot, connectedHosts } = measurementFixture()

    measurer.measure([slot("one", 0)])
    measurer.measure([slot("two", 0)])
    assert.equal(operations.filter((operation) => operation === "write:insert-host").length, 1)
    assert.equal(connectedHosts(), 1)
    measurer.dispose()
    assert.equal(connectedHosts(), 0)
    operations.length = 0
    assert.equal(measurer.measure([slot("one", 0)]), 30)
    assert.ok(operations.includes("write:insert-host"), "re-creates the host after dispose")
    assert.ok(operations.includes("read:probe"), "dispose also clears cached widths")
  })

  it("reuses widths for duplicate names and recalculates overflow after a resize", () => {
    const { measurer, operations, slot } = measurementFixture()

    assert.equal(measurer.measure([slot("file", 10), slot("file", 20)]), 30)
    assert.equal(operations.filter((operation) => operation === "read:probe").length, 1)
    operations.length = 0
    assert.equal(measurer.measure([slot("file", 35)]), 5)
    assert.deepEqual(operations, ["read:font", "read:slot"])
  })

  it("distinguishes names and fonts, including cached zero-width names", () => {
    const { measurer, operations, slot } = measurementFixture()

    assert.equal(measurer.measure([slot("file", 0)]), 40)
    assert.equal(measurer.measure([slot("file", 0, "bold 14px Inter")]), 80)
    assert.equal(measurer.measure([slot("other", 0)]), 50)
    assert.equal(measurer.measure([slot("", 0)]), 0)
    operations.length = 0
    assert.equal(measurer.measure([slot("", 0)]), 0)
    assert.deepEqual(operations, ["read:font", "read:slot"])
  })

  it("remeasures when the loaded font metrics change", () => {
    const { measurer, slot, setFontScale } = measurementFixture()

    assert.equal(measurer.measure([slot("file", 0)]), 40)
    setFontScale(12)
    measurer.clearCache()
    assert.equal(measurer.measure([slot("file", 0)]), 48)
  })

  it("does not touch the live DOM for an empty tree", () => {
    const { measurer, operations } = measurementFixture()

    assert.equal(measurer.measure([]), 0)
    assert.deepEqual(operations, [])
  })
})

describe("fileTreeTargetPanelWidth", () => {
  it("keeps the current width when overflow is only a few pixels", () => {
    assert.equal(
      fileTreeTargetPanelWidth({
        currentWidth: 280,
        overflow: 4,
        maxWidth: 600,
      }),
      280
    )
  })

  it("grows by the overflow plus a buffer, capped at max", () => {
    assert.equal(
      fileTreeTargetPanelWidth({
        currentWidth: 280,
        overflow: 40,
        maxWidth: 600,
      }),
      280 + 40 + FILE_TREE_OVERFLOW_BUFFER_PX
    )

    assert.equal(
      fileTreeTargetPanelWidth({
        currentWidth: 280,
        overflow: 400,
        maxWidth: 360,
      }),
      360
    )
  })
})
