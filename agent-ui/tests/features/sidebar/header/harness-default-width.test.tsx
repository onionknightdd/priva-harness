import assert from "node:assert/strict"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "SVGElement", "DOMRect", "DOMException", "getComputedStyle"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
})
dom.window.matchMedia = (query) => ({ matches: query.includes("prefers-reduced-motion"), media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true })

const observers = new Set<MeasuredResizeObserver>()
class MeasuredResizeObserver {
  constructor(readonly callback: ResizeObserverCallback) { observers.add(this) }
  observe() {}
  unobserve() {}
  disconnect() { observers.delete(this) }
}
Object.assign(globalThis, { ResizeObserver: MeasuredResizeObserver })
after(() => dom.window.close())

let transitionWidth: number | undefined
let chromeWidth = 106
const originalRect = dom.window.HTMLElement.prototype.getBoundingClientRect
dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
  const wrapper = this.closest<HTMLElement>('[data-slot="sidebar-wrapper"]')
  const width = transitionWidth ?? Number.parseFloat(wrapper?.style.getPropertyValue("--sidebar-width") ?? "0")
  if (this.dataset.fixture === "sidebar") return new DOMRect(0, 0, width, 600)
  if (this.dataset.fixture === "row") return new DOMRect(0, 0, Math.max(0, width - chromeWidth), 16)
  if (this.dataset.fixture === "measurement") {
    const labelWidths = [...this.querySelectorAll<HTMLElement>("[data-width]")].map((label) => Number(label.dataset.width))
    return new DOMRect(0, 0, Math.max(...labelWidths), 16)
  }
  return originalRect.call(this)
}

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { SidebarProvider, useSidebar } = await import("../../../../src/components/ui/sidebar.tsx")
const { useHarnessDefaultWidth } = await import("../../../../src/features/sidebar/header/use-harness-default-width.ts")

type Options = {
  open: boolean
  widths: number[]
  selected: string
  defaultWidth: number
  minWidth: number
  maxWidth: number
  fit: boolean
}

async function mount(overrides: Partial<Options> = {}) {
  transitionWidth = undefined
  chromeWidth = 106
  let options: Options = { open: true, widths: [90, 208.4], selected: "Pi", defaultWidth: 300, minWidth: 0, maxWidth: 384, fit: true, ...overrides }
  let sidebar!: ReturnType<typeof useSidebar>
  function Probe({ widths, selected }: Pick<Options, "widths" | "selected">) {
    const { rowRef, measurementRef } = useHarnessDefaultWidth()
    return <div data-slot="sidebar-container" data-fixture="sidebar">
      <span ref={rowRef} data-fixture="row">{selected}
        <span ref={measurementRef} data-fixture="measurement" aria-hidden="true">
          {widths.map((width, index) => <span key={index} data-width={width}>Harness {index}</span>)}
        </span>
      </span>
    </div>
  }
  function Reader() {
    sidebar = useSidebar()
    return <output>{sidebar.sidebarWidth}</output>
  }
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const update = async (patch: Partial<Options>) => {
    options = { ...options, ...patch }
    await act(async () => root.render(<React.StrictMode>
      <SidebarProvider open={options.open} defaultWidth={options.defaultWidth} minWidth={options.minWidth} maxWidth={options.maxWidth}
        keyboardShortcut={false} stateCookieName={false} widthCookieName="fixture_sidebar_width">
        <Reader />
        {options.fit && <Probe widths={options.widths} selected={options.selected} />}
      </SidebarProvider>
    </React.StrictMode>))
  }
  await update({})
  return {
    update,
    width: () => sidebar.sidebarWidth,
    wrapper: () => host.querySelector<HTMLElement>('[data-slot="sidebar-wrapper"]')!,
    commit: async (width: number) => { await act(async () => sidebar.commitSidebarWidth(width)) },
    notify: async () => { await act(async () => { for (const observer of [...observers]) observer.callback([], observer as unknown as ResizeObserver) }) },
    async close() {
      await act(async () => root.unmount())
      host.remove()
      document.cookie = "fixture_sidebar_width=; Max-Age=0; path=/"
    },
  }
}

test("fits the widest complete label plus sidebar chrome and rounds up fractional pixels", async () => {
  const view = await mount()
  try {
    assert.equal(view.width(), 315)
    assert.ok(view.width() - chromeWidth >= 208.4)
    assert.equal(document.cookie, "", "Measuring a default must not store a custom preference")
    await view.update({ selected: "Claude Agent SDK" })
    await view.notify()
    assert.equal(view.width(), 315, "Changing the selection must not resize the default")
    assert.equal(observers.size, 1)
  } finally { await view.close() }
  assert.equal(observers.size, 0)
})

test("adapts defaults to changed fonts and layout spacing in either direction", async () => {
  const view = await mount()
  try {
    await view.update({ widths: [96, 225.5] })
    chromeWidth = 112
    await view.notify()
    assert.equal(view.width(), 338)
    await view.update({ widths: [90, 180] })
    await view.notify()
    assert.equal(view.width(), 292)
  } finally { await view.close() }
})

test("uses a saved manual width even when the complete label requires more space", async () => {
  document.cookie = "fixture_sidebar_width=230; path=/"
  const view = await mount()
  try {
    assert.equal(view.width(), 230)
    await view.update({ widths: [90, 240] })
    await view.notify()
    assert.equal(view.width(), 230)
    assert.equal(document.cookie, "fixture_sidebar_width=230")
  } finally { await view.close() }
})

test("manual resizing becomes the preference and is restored after remount", async () => {
  const view = await mount()
  try {
    await view.commit(245)
    await view.update({ widths: [90, 240] })
    await view.notify()
    assert.equal(view.width(), 245)
    assert.equal(document.cookie, "fixture_sidebar_width=245")
    await view.update({ open: false })
    await view.update({ open: true })
    assert.equal(view.width(), 245)
  } finally { await view.close() }

  document.cookie = "fixture_sidebar_width=245; path=/"
  const restored = await mount()
  try { assert.equal(restored.width(), 245) } finally { await restored.close() }
})

test("waits for expansion and does not fight an active drag", async () => {
  const view = await mount({ open: false })
  try {
    assert.equal(view.width(), 300)
    transitionWidth = 48
    await view.update({ open: true })
    await view.notify()
    assert.equal(view.width(), 300)
    transitionWidth = undefined
    await view.notify()
    assert.equal(view.width(), 315)

    view.wrapper().setAttribute("data-resizing", "true")
    await view.update({ widths: [90, 240] })
    await view.notify()
    assert.equal(view.width(), 315)
    await view.commit(250)
    view.wrapper().removeAttribute("data-resizing")
    await view.notify()
    assert.equal(view.width(), 250)
  } finally { await view.close() }
})

test("ignores invalid saved widths and respects the existing expanded limits", async () => {
  for (const stored of ["invalid", "170"]) {
    document.cookie = `fixture_sidebar_width=${stored}; path=/`
    const view = await mount()
    try {
      assert.equal(view.width(), 315)
      await view.update({ widths: [10] })
      await view.notify()
      assert.equal(view.width(), 180)
      await view.update({ widths: [400] })
      await view.notify()
      assert.equal(view.width(), 384)
    } finally { await view.close() }
  }
})

test("keeps other Sidebar providers' default and minimum-width behavior", async () => {
  const view = await mount({ fit: false, defaultWidth: 480, minWidth: 600, maxWidth: 900 })
  try {
    assert.equal(view.width(), 600)
    await view.update({ minWidth: 400 })
    assert.equal(view.width(), 600)
    await view.update({ minWidth: 650 })
    assert.equal(view.width(), 650)
  } finally { await view.close() }
})
