import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "DocumentFragment", "ShadowRoot", "SVGElement", "Event", "EventTarget", "MessageEvent", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})
dom.window.matchMedia = query => ({ matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, onchange: null })
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css") || url.endsWith("?raw")) return { format: "module", source: "export default ''", shortCircuit: true }
    return nextLoad(url, context)
  },
})
const originalSocket = globalThis.WebSocket
class Socket extends EventTarget {
  static instances: Socket[] = []
  readyState = 1
  constructor() { super(); Socket.instances.push(this) }
  send() {}
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")) }
}
Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: Socket })
after(() => { hooks.deregister(); globalThis.WebSocket = originalSocket; dom.window.close() })

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { I18nextProvider, initReactI18next } = await import("react-i18next")
const i18n = (await import("i18next")).createInstance()
await i18n.use(initReactI18next).init({ lng: "en", resources: {} })
const { WhiteboardRenderer } = await import("../../../src/features/whiteboard/whiteboard-renderer.tsx")

test("a failed initial board connection keeps the session file picker usable", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const files = ["broken.board.json", "working.board.json"].map(name => ({ name, path: `/work/.whiteboard/session/${name}` }))
  const selected: string[] = []
  let refreshed = 0
  try {
    await act(async () => root.render(React.createElement(I18nextProvider, { i18n }, React.createElement(WhiteboardRenderer, {
      path: files[0].path,
      filePicker: { files, loading: false, error: null, onRefresh: () => { refreshed++ }, onSelect: path => selected.push(path) },
    }))))
    assert.equal(host.querySelector('[aria-label="whiteboard.switchFile"]')?.textContent, "broken.board")
    await act(async () => Socket.instances.at(-1)!.close())
    assert.match(host.textContent ?? "", /whiteboard.disconnected/)
    await act(async () => (host.querySelector('[aria-label="whiteboard.switchFile"]') as HTMLButtonElement).click())
    assert.equal(refreshed, 1)
    const choice = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(item => item.textContent === "working.board")
    assert.ok(choice)
    await act(async () => choice.click())
    assert.deepEqual(selected, [files[1].path])
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
