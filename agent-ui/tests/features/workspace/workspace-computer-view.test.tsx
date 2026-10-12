import assert from "node:assert/strict"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost:15173", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "DocumentFragment", "ShadowRoot", "SVGElement", "Event", "FocusEvent", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})
dom.window.matchMedia = (query) => ({ matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, onchange: null })
const originalFetch = globalThis.fetch
type Pending = { signal: AbortSignal; resolve: (response: Response) => void }
const requests: Pending[] = []
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/sandbox/computer")
  return new Promise<Response>((resolve) => requests.push({ signal: options?.signal as AbortSignal, resolve }))
}
after(() => { globalThis.fetch = originalFetch; dom.window.close() })

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { MotionConfig } = await import("motion/react")
const { I18nextProvider, initReactI18next } = await import("react-i18next")
const i18n = (await import("i18next")).createInstance()
const { en } = await import("../../../src/i18n/locales/en.ts")
const { zhCN } = await import("../../../src/i18n/locales/zh-CN.ts")
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en }, "zh-CN": { translation: zhCN } } })
const { SidebarProvider } = await import("../../../src/components/ui/sidebar.tsx")
const { WorkspaceComputerView } = await import("../../../src/features/workspace/views/workspace-computer-view.tsx")
const { WORKSPACE_MODULES } = await import("../../../src/features/workspace/workspace-modules.ts")

const latest = () => requests.at(-1)!
async function mount() {
  requests.length = 0
  await i18n.changeLanguage("en")
  Object.defineProperty(document, "hidden", { configurable: true, value: false })
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const update = async (open: boolean, selected = true) => {
    await act(async () => root.render(<React.StrictMode><I18nextProvider i18n={i18n}><MotionConfig reducedMotion="always">
      <SidebarProvider open={open} keyboardShortcut={false}>{selected && <WorkspaceComputerView />}</SidebarProvider>
    </MotionConfig></I18nextProvider></React.StrictMode>))
  }
  await update(false)
  return { host, update, close: async () => { await act(async () => root.unmount()); host.remove() } }
}

test("Computer is an enabled Workspace module between files and future modules", () => {
  assert.deepEqual(WORKSPACE_MODULES.slice(0, 3).map((module) => module.id), ["tasks", "files", "computer"])
  assert.equal(WORKSPACE_MODULES.find((module) => module.id === "computer")?.disabled, undefined)
})

test("closed Workspace does not connect; opening, closing and switching tabs own the request lifecycle", async () => {
  const view = await mount()
  try {
    assert.equal(requests.length, 0)
    await view.update(true)
    assert.ok(view.host.textContent?.includes("Connecting to the desktop"))
    const pending = latest()
    await view.update(false)
    assert.equal(pending.signal.aborted, true)
    await act(async () => pending.resolve(Response.json({ available: false })))
    assert.ok(!view.host.textContent?.includes("Desktop unavailable"), "an old response must not update a closed view")
    await view.update(true)
    assert.notEqual(latest(), pending)
    const reopened = latest()
    await view.update(true, false)
    assert.equal(reopened.signal.aborted, true)
    assert.equal(view.host.querySelector("[data-workspace-computer]"), null)
  } finally { await view.close() }
})

test("unavailable and failed connections offer translated retry without a control toolbar", async () => {
  const view = await mount()
  try {
    await view.update(true)
    await act(async () => latest().resolve(Response.json({ available: false })))
    assert.ok(view.host.textContent?.includes("This Runner does not have a desktop available."))
    assert.equal(view.host.querySelectorAll("button").length, 1)
    const first = latest()
    await act(async () => view.host.querySelector<HTMLButtonElement>("button")!.click())
    assert.notEqual(latest(), first)
    await act(async () => latest().resolve(Response.json({}, { status: 503 })))
    assert.ok(view.host.textContent?.includes("Could not connect to the desktop"))
    await act(async () => { await i18n.changeLanguage("zh-CN") })
    assert.ok(view.host.querySelector('[aria-label="Debian 桌面"]'))
    assert.ok(view.host.textContent?.includes("无法连接桌面"))
    assert.equal(view.host.querySelector("button")?.textContent, "重新连接")
  } finally { await view.close() }
})

test("backgrounding aborts pending work and foregrounding establishes a fresh connection", async () => {
  const view = await mount()
  try {
    await view.update(true)
    const pending = latest()
    Object.defineProperty(document, "hidden", { configurable: true, value: true })
    await act(async () => document.dispatchEvent(new Event("visibilitychange")))
    assert.equal(pending.signal.aborted, true)
    const count = requests.length
    await view.update(false)
    await view.update(true)
    assert.equal(requests.length, count)
    Object.defineProperty(document, "hidden", { configurable: true, value: false })
    await act(async () => document.dispatchEvent(new Event("visibilitychange")))
    assert.notEqual(latest(), pending)
  } finally { await view.close() }
})
