import assert from "node:assert/strict"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}

class ResizeProbe {
  static instances = new Set<ResizeProbe>()
  target?: Element
  constructor(readonly callback: ResizeObserverCallback) { ResizeProbe.instances.add(this) }
  observe(target: Element) { this.target = target }
  disconnect() { ResizeProbe.instances.delete(this) }
  resize(width: number, height: number) {
    this.callback([{ target: this.target!, contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
}

class IntersectionProbe {
  static instances = new Set<IntersectionProbe>()
  target?: Element
  constructor(readonly callback: IntersectionObserverCallback, readonly options: IntersectionObserverInit) {
    IntersectionProbe.instances.add(this)
  }
  observe(target: Element) { this.target = target }
  disconnect() { IntersectionProbe.instances.delete(this) }
  intersect(isIntersecting: boolean) {
    this.callback([{ target: this.target!, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: ResizeProbe, IntersectionObserver: IntersectionProbe })
const React = await import("react")
const { act, useRef, useEffect, StrictMode } = React
const { createRoot } = await import("react-dom/client")
const { useChartDimensions } = await import("../../../src/features/agent-message/render-ui/use-chart-dimensions.ts")
after(() => dom.window.close())

async function mount(top = 100) {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  let width = 754
  let height = 192
  let y = top
  let commits = 0
  let childMounts = 0
  const rect = (top: number, width: number, height: number) => ({ x: 0, y: top, top, bottom: top + height, left: 0, right: width, width, height, toJSON() {} })
  const oldRect = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function () {
    return this.dataset.slot === "message-scroller-viewport" ? rect(50, 1000, 600) : rect(y, width, height)
  }
  function Child() { useEffect(() => { childMounts++ }, []); return <span>Chart state</span> }
  function Probe() {
    const ref = useRef<HTMLDivElement>(null)
    const { dimensions, nearViewport } = useChartDimensions(ref)
    useEffect(() => { commits++ })
    return <div ref={ref} data-size={`${dimensions.width}x${dimensions.height}`} data-near={nearViewport}><Child /></div>
  }
  await act(async () => root.render(<StrictMode><div data-slot="message-scroller-viewport"><Probe /></div></StrictMode>))
  const node = host.querySelector<HTMLElement>("[data-size]")!
  const resize = [...ResizeProbe.instances][0]!
  const intersection = [...IntersectionProbe.instances][0]!
  return {
    node, resize, intersection,
    commits: () => commits,
    mounts: () => childMounts,
    geometry(nextWidth: number, nextHeight = height, nextTop = y) { width = nextWidth; height = nextHeight; y = nextTop },
    async unmount() {
      await act(async () => root.unmount())
      host.remove()
      HTMLElement.prototype.getBoundingClientRect = oldRect
      assert.equal(ResizeProbe.instances.size, 0)
      assert.equal(IntersectionProbe.instances.size, 0)
    },
  }
}

test("visible charts receive each changed pixel size without a debounce", async () => {
  const chart = await mount()
  try {
    assert.equal(chart.node.dataset.size, "754x192")
    assert.equal(chart.intersection.options.root, chart.node.parentElement)
    assert.equal(chart.intersection.options.rootMargin, "400px 0px")
    for (const width of [700, 660, 500, 475]) {
      await act(async () => chart.resize.resize(width, 192))
      assert.equal(chart.node.dataset.size, `${width}x192`)
    }
    const commits = chart.commits()
    await act(async () => { chart.resize.resize(475.1, 192.1); chart.resize.resize(475.2, 192.2) })
    assert.equal(chart.commits(), commits)
  } finally { await chart.unmount() }
})

test("offscreen resizes do not render, and re-entry uses current geometry without remounting", async () => {
  const chart = await mount(-1500)
  try {
    const commits = chart.commits()
    const mounts = chart.mounts()
    assert.equal(chart.node.dataset.near, "false")
    for (const width of [700, 660, 500, 475]) {
      chart.geometry(width)
      await act(async () => chart.resize.resize(width, 192))
    }
    assert.equal(chart.commits(), commits)
    assert.equal(chart.node.dataset.size, "754x192")
    // Intersection can precede the next ResizeObserver notification.
    chart.geometry(490, 192, 300)
    await act(async () => chart.intersection.intersect(true))
    assert.equal(chart.node.dataset.size, "490x192")
    assert.equal(chart.node.dataset.near, "true")
    assert.equal(chart.mounts(), mounts)
  } finally { await chart.unmount() }
})

test("leaving the viewport pauses later resizes and keyboard focus restores the latest size", async () => {
  const chart = await mount()
  try {
    await act(async () => chart.intersection.intersect(false))
    const commits = chart.commits()
    chart.geometry(430, 224, -1600)
    await act(async () => chart.resize.resize(430, 224))
    assert.equal(chart.commits(), commits)
    await act(async () => chart.node.dispatchEvent(new Event("focusin", { bubbles: true })))
    assert.equal(chart.node.dataset.size, "430x224")
    assert.equal(chart.node.dataset.near, "true")
  } finally { await chart.unmount() }
})

test("temporarily hidden or subpixel containers keep the last mounted chart size", async () => {
  const chart = await mount()
  try {
    const mounts = chart.mounts()
    await act(async () => { chart.resize.resize(0, 0); chart.resize.resize(0.1, 0.1) })
    assert.equal(chart.node.dataset.size, "754x192")
    await act(async () => chart.resize.resize(600, 224))
    assert.equal(chart.node.dataset.size, "600x224")
    assert.equal(chart.mounts(), mounts)
  } finally { await chart.unmount() }
})
