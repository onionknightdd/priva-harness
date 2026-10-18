import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

import type { SessionTerminalViewProps } from "../../../src/features/agent-message/components/session-terminal-view.tsx"

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "DocumentFragment", "ShadowRoot", "SVGElement", "Event", "EventTarget", "MessageEvent", "MouseEvent", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})
Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() } })
dom.window.matchMedia = (query) => ({ matches: true, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, onchange: null })

// Keep the real view and WebSocket client; replace only xterm's canvas runtime.
const modules: Record<string, string> = {
  "@xterm/xterm": `export class Terminal {
    static instances = [];
    cols = 80; rows = 24; resetCount = 0; disposed = false;
    constructor(options) { this.options = options; Terminal.instances.push(this); }
    loadAddon() {}
    open(host) { this.host = host; }
    onData() { return { dispose() {} }; }
    onResize() { return { dispose() {} }; }
    reset() { this.resetCount++; this.host.textContent = ""; }
    write(bytes) { this.host.textContent += new TextDecoder().decode(bytes); }
    focus() {}
    dispose() { this.disposed = true; }
  }`,
  "@xterm/addon-fit": "export class FitAddon { fit() {} }",
  "@xterm/addon-webgl": "export class WebglAddon { onContextLoss() {} clearTextureAtlas() {} dispose() {} }",
}
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const source = modules[specifier]
    return source === undefined ? nextResolve(specifier, context)
      : { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
  },
  load(url, context, nextLoad) {
    return url.endsWith(".css") ? { format: "module", source: "export default {}", shortCircuit: true }
      : nextLoad(url, context)
  },
})

class Socket extends EventTarget {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 0
  closeCount = 0
  constructor(readonly url: string) { super(); Socket.instances.push(this) }
  send() {}
  ready() {
    this.readyState = Socket.OPEN
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "ready", sessionId: "session", adopted: true, cols: 80, rows: 24 }) }))
  }
  output(text: string) {
    this.dispatchEvent(new MessageEvent("message", { data: new TextEncoder().encode(text).buffer }))
  }
  close() {
    this.closeCount += 1
    this.readyState = 3
    this.dispatchEvent(new Event("close"))
  }
}
const originalSocket = globalThis.WebSocket
Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: Socket })
after(() => { hooks.deregister(); globalThis.WebSocket = originalSocket; dom.window.close() })

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { MotionConfig } = await import("motion/react")
const { I18nextProvider, initReactI18next } = await import("react-i18next")
const i18n = (await import("i18next")).createInstance()
const { en } = await import("../../../src/i18n/locales/en.ts")
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } } })
const { SessionTerminalView } = await import("../../../src/features/agent-message/components/session-terminal-view.tsx")
const { Terminal } = await import("@xterm/xterm") as unknown as {
  Terminal: { instances: { host: HTMLElement; resetCount: number; disposed: boolean }[] }
}

async function mount(harness: "claude" | "pi", visualizeMode = false) {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  let props: SessionTerminalViewProps = {
    harness, cwd: "/work", model: "profile:model", effort: "medium", contextWindow: 200000,
    sessionId: "session", hidden: false, visualizeMode,
  }
  const update = async (next: Partial<SessionTerminalViewProps>) => {
    props = { ...props, ...next }
    await act(async () => root.render(<I18nextProvider i18n={i18n}><MotionConfig reducedMotion="always">
      <SessionTerminalView {...props} />
    </MotionConfig></I18nextProvider>))
  }
  await update({})
  return { host, update, close: async () => { await act(async () => root.unmount()); host.remove() } }
}

for (const harness of ["claude", "pi"] as const) {
  test(`${harness}: changing visualize mode preserves the viewer socket, terminal screen and output`, async () => {
    const view = await mount(harness)
    const socket = Socket.instances.at(-1)!
    const terminal = Terminal.instances.at(-1)!
    const socketCount = Socket.instances.length
    const resetCount = terminal.resetCount
    try {
      assert.equal(new URL(socket.url).searchParams.get("visualizeMode"), "false")
      await act(async () => { socket.ready(); socket.output("before ") })
      await view.update({ visualizeMode: true, hidden: true })
      await act(async () => socket.output("during "))
      await view.update({ visualizeMode: false, hidden: false })
      await act(async () => socket.output("after"))
      assert.equal(Socket.instances.length, socketCount)
      assert.equal(socket.closeCount, 0)
      assert.equal(socket.readyState, Socket.OPEN)
      assert.equal(terminal.resetCount, resetCount)
      assert.equal(terminal.host.textContent, "before during after")
      assert.equal(terminal.disposed, false)
    } finally { await view.close() }
    assert.ok(socket.closeCount > 0)
    assert.equal(terminal.disposed, true)
  })
}

test("an explicit reconnect reads the latest visualize mode without replacing xterm", async () => {
  const view = await mount("claude", true)
  const socket = Socket.instances.at(-1)!
  const terminal = Terminal.instances.at(-1)!
  const socketCount = Socket.instances.length
  const terminalCount = Terminal.instances.length
  try {
    assert.equal(new URL(socket.url).searchParams.get("visualizeMode"), "true")
    await act(async () => socket.ready())
    await view.update({ visualizeMode: false })
    assert.equal(Socket.instances.length, socketCount)
    await act(async () => socket.close())
    const reconnect = [...view.host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes(i18n.t("agentMessage.terminalView.reconnect")))
    assert.ok(reconnect)
    await act(async () => reconnect.click())
    assert.equal(Socket.instances.length, socketCount + 1)
    assert.equal(new URL(Socket.instances.at(-1)!.url).searchParams.get("visualizeMode"), "false")
    assert.equal(Terminal.instances.length, terminalCount)
    assert.equal(terminal.resetCount, 2)
  } finally { await view.close() }
})
