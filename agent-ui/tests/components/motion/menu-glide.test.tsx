import assert from "node:assert/strict"
import { after, test, type TestContext } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
after(() => dom.window.close())

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { useMenuGlide } = await import("../../../src/components/motion/menu-glide")

const ROW_HEIGHT = 32

function Menu({ enabled, listRef }: { enabled?: boolean; listRef?: React.Ref<HTMLDivElement> }) {
  const glideRef = useMenuGlide<HTMLDivElement>(listRef, enabled)
  return (
    <div ref={glideRef} data-testid="list">
      <div role="menuitem">Rename</div>
      <div role="menuitem">Move</div>
      <div role="menuitem" data-variant="destructive">Delete</div>
    </div>
  )
}

async function fixture(t: TestContext, props: React.ComponentProps<typeof Menu> = {}) {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  await act(async () => root.render(<Menu {...props} />))
  const list = host.querySelector<HTMLElement>("[data-testid=list]")!
  const rows = [...list.querySelectorAll<HTMLElement>("[role=menuitem]")]
  // jsdom has no layout: give each row the box a real menu row would have.
  rows.forEach((row, index) => {
    Object.defineProperties(row, {
      offsetParent: { get: () => list },
      offsetTop: { get: () => 4 + index * ROW_HEIGHT },
      offsetLeft: { get: () => 4 },
      offsetWidth: { get: () => 180 },
      offsetHeight: { get: () => ROW_HEIGHT },
    })
  })
  let mounted = true
  const unmount = async () => {
    if (!mounted) return
    mounted = false
    await act(async () => root.unmount())
  }
  t.after(async () => {
    await unmount()
    host.remove()
  })
  const highlight = async (row: HTMLElement | null) => {
    for (const other of rows) other.removeAttribute("data-highlighted")
    row?.setAttribute("data-highlighted", "")
    // MutationObserver callbacks are delivered as microtasks.
    await delay(0)
  }
  return { list, rows, highlight, unmount }
}

const state = (list: HTMLElement) => list.getAttribute("data-menu-glide")
const box = (list: HTMLElement) =>
  ["top", "left", "width", "height"].map((side) => list.style.getPropertyValue(`--menu-glide-${side}`))

test("stays idle until a row is highlighted", async (t) => {
  const { list } = await fixture(t)
  assert.equal(state(list), "idle")
  assert.deepEqual(box(list), ["", "", "", ""])
})

test("mirrors the highlighted row and follows it to the next row", async (t) => {
  const { list, rows, highlight } = await fixture(t)

  await highlight(rows[0])
  assert.equal(state(list), "active")
  assert.deepEqual(box(list), ["4px", "4px", "180px", "32px"])

  await highlight(rows[1])
  assert.equal(state(list), "active")
  assert.deepEqual(box(list), ["36px", "4px", "180px", "32px"])
})

test("holds the block across the gap between two rows", async (t) => {
  const { list, rows, highlight } = await fixture(t)
  await highlight(rows[0])

  await highlight(null)
  assert.equal(state(list), "active")
  await highlight(rows[1])
  await delay(140)

  assert.equal(state(list), "active")
  assert.deepEqual(box(list), ["36px", "4px", "180px", "32px"])
})

test("fades out once no row is highlighted", async (t) => {
  const { list, rows, highlight } = await fixture(t)
  await highlight(rows[0])

  await highlight(null)
  await delay(140)

  assert.equal(state(list), "idle")
})

test("leaves destructive rows to their own background", async (t) => {
  const { list, rows, highlight } = await fixture(t)
  await highlight(rows[0])

  await highlight(rows[2])
  await delay(140)

  assert.equal(state(list), "idle")
  assert.deepEqual(box(list), ["4px", "4px", "180px", "32px"])
})

test("does nothing when disabled", async (t) => {
  const { list, rows, highlight } = await fixture(t, { enabled: false })
  await highlight(rows[0])
  assert.equal(state(list), null)
})

test("forwards the element to the caller's ref and cleans up on unmount", async (t) => {
  const listRef = React.createRef<HTMLDivElement>()
  const { list, rows, highlight, unmount } = await fixture(t, { listRef })
  assert.equal(listRef.current, list)
  await highlight(rows[0])

  await unmount()

  assert.equal(listRef.current, null)
  assert.equal(state(list), null)
})
