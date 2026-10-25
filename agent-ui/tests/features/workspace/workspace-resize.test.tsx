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
dom.window.Element.prototype.setPointerCapture = () => {}

class ResizeProbe {
  static instances = new Set<ResizeProbe>()
  constructor(readonly callback: ResizeObserverCallback) { ResizeProbe.instances.add(this) }
  observe() {}
  disconnect() { ResizeProbe.instances.delete(this) }
}
Object.assign(globalThis, { ResizeObserver: ResizeProbe })
after(() => dom.window.close())

const React = await import("react")
const { act, Profiler, StrictMode } = React
const { createRoot } = await import("react-dom/client")
const { Sidebar, SidebarProvider, useSidebar } = await import("../../../src/components/ui/sidebar.tsx")
const { PopupsArmedContext } = await import("../../../src/components/ui/popups-armed-context.ts")
const { WorkspaceDensityBridge, useWorkspaceTakesMajority } = await import("../../../src/features/workspace/workspace-density.tsx")

type Options = { shellWidth: number; enabled: boolean; maximized: boolean; min: number; max: number; side: "left" | "right" }
async function mount(overrides: Partial<Options> = {}) {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  let options: Options = { shellWidth: 1000, enabled: true, maximized: false, min: 200, max: 900, side: "right", ...overrides }
  let sidebar!: ReturnType<typeof useSidebar>
  const commits = { handle: 0, density: 0 }
  function Reader() { sidebar = useSidebar(); return null }
  function DensityReader() { return <output>{String(useWorkspaceTakesMajority())}</output> }
  const update = async (patch: Partial<Options>) => {
    options = { ...options, ...patch }
    await act(async () => root.render(<StrictMode><PopupsArmedContext.Provider value={false}>
      <SidebarProvider defaultWidth={500} minWidth={options.min} maxWidth={options.max} widthCookieName={false} stateCookieName={false} keyboardShortcut={false}>
        <Reader />
        <Profiler id="handle" onRender={() => commits.handle++}>
          <Sidebar side={options.side} resizable resizeLabel="Resize fixture" />
        </Profiler>
        <Profiler id="density" onRender={() => commits.density++}>
          <WorkspaceDensityBridge shellWidth={options.shellWidth} workspaceEnabled={options.enabled} maximized={options.maximized}>
            <DensityReader />
          </WorkspaceDensityBridge>
        </Profiler>
      </SidebarProvider>
    </PopupsArmedContext.Provider></StrictMode>))
  }
  await update({})
  const handle = host.querySelector<HTMLElement>('[role="separator"]')!
  const wrapper = host.querySelector<HTMLElement>('[data-slot="sidebar-wrapper"]')!
  return {
    handle, wrapper, commits, update,
    width: () => sidebar.sidebarWidth,
    majority: () => host.querySelector("output")!.textContent,
    open: () => sidebar.open,
    async pointer(type: string, width = 500, pointerId = 1) {
      const event = new dom.window.MouseEvent(type, { bubbles: true, button: 0, clientX: options.side === "left" ? width : window.innerWidth - width })
      Object.defineProperty(event, "pointerId", { value: pointerId })
      await act(async () => { handle.dispatchEvent(event) })
    },
    async key(key: string) {
      await act(async () => { handle.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true })) })
    },
    async notify(width?: number) {
      if (width !== undefined) wrapper.style.setProperty("--sidebar-width", `${width}px`)
      await act(async () => { for (const observer of ResizeProbe.instances) observer.callback([], observer as unknown as ResizeObserver) })
    },
    async setOpen(open: boolean) { await act(async () => sidebar.setOpen(open)) },
    async close() { await act(async () => root.unmount()); host.remove() },
  }
}

test("drag keeps live geometry and accessible width in sync without handle or density commits per pixel", async () => {
  const view = await mount()
  try {
    await view.pointer("pointerdown")
    const before = { ...view.commits }
    for (const width of [510, 520, 580, 600, 600.1]) {
      await view.pointer("pointermove", width)
      await view.notify()
      assert.equal(view.handle.getAttribute("aria-valuenow"), String(Math.round(width)))
      assert.equal(view.wrapper.style.getPropertyValue("--sidebar-width"), `${Math.round(width)}px`)
      assert.equal(view.majority(), "false", "The boundary remains strictly greater than 60%")
    }
    assert.deepEqual(view.commits, before)
    assert.equal(view.width(), 500, "Transient width is committed only at drag end")
    await view.pointer("pointermove", 601)
    await view.notify()
    assert.equal(view.majority(), "true")
    const pastBoundary = view.commits.density
    await view.pointer("pointermove", 650)
    await view.notify()
    assert.equal(view.commits.density, pastBoundary)
    await view.pointer("pointerup", 650)
    assert.equal(view.width(), 650)
    assert.equal(view.handle.getAttribute("aria-valuenow"), "650")
    assert.equal(view.wrapper.hasAttribute("data-resizing"), false)
    assert.equal(document.body.style.userSelect, "")
  } finally { await view.close() }
  assert.equal(ResizeProbe.instances.size, 0)
})

test("density uses the latest live width when the shell changes and preserves open, maximized and enabled rules", async () => {
  const view = await mount()
  try {
    await view.notify(590)
    await view.update({ shellWidth: 900 })
    assert.equal(view.majority(), "true", "Use live 590px, not the committed 500px")
    await view.setOpen(false)
    assert.equal(view.majority(), "false")
    await view.update({ maximized: true })
    assert.equal(view.majority(), "true")
    await view.update({ enabled: false })
    assert.equal(view.majority(), "false")
    await view.update({ enabled: true, maximized: false, shellWidth: 0 })
    assert.equal(view.majority(), "false")
    await view.update({ shellWidth: 1000 })
    await view.setOpen(true)
    await view.notify(601)
    assert.equal(view.majority(), "true")
    await view.notify(600)
    assert.equal(view.majority(), "false")
  } finally { await view.close() }
})

test("cancel and lost capture commit the live width; unrelated pointers cannot resize", async () => {
  for (const end of ["pointercancel", "lostpointercapture"]) {
    const view = await mount()
    try {
      await view.pointer("pointerdown")
      await view.pointer("pointermove", 550)
      await view.pointer("pointermove", 700, 2)
      assert.equal(view.handle.getAttribute("aria-valuenow"), "550")
      await view.pointer(end)
      assert.equal(view.width(), 550)
      assert.equal(view.handle.getAttribute("aria-valuenow"), "550")
      assert.equal(view.wrapper.hasAttribute("data-resizing"), false)
      await view.pointer("pointermove", 700)
      assert.equal(view.width(), 550)
    } finally { await view.close() }
  }
})

test("keyboard, clamping, external limits and collapse keep the width contract", async () => {
  const view = await mount({ side: "left" })
  try {
    await view.key("ArrowRight")
    assert.equal(view.width(), 508)
    await view.key("Home")
    assert.equal(view.width(), 200)
    await view.key("End")
    assert.equal(view.width(), 900)
    await view.update({ max: 700 })
    assert.equal(view.handle.getAttribute("aria-valuenow"), "700")
    await view.key("ArrowLeft")
    assert.equal(view.width(), 692)
    await view.update({ min: 0 })
    await view.key("Home")
    assert.equal(view.open(), false)
    assert.equal(view.handle.getAttribute("aria-valuenow"), "692")
  } finally { await view.close() }
})
