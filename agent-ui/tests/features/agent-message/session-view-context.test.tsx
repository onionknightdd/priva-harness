import assert from "node:assert/strict"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"
import type { SessionViewIdentity } from "../../../src/features/agent-message/session-view.ts"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "Element", "Node", "DocumentFragment", "ShadowRoot", "SVGElement", "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})
dom.window.matchMedia = (query) => ({ matches: true, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, onchange: null })
dom.window.HTMLElement.prototype.getAnimations = () => []
const originalFetch = globalThis.fetch
globalThis.fetch = async (input) => {
  assert.equal(String(input), "/api/sandbox/agent/profile")
  return Response.json({ queue_behavior: "follow-up" })
}
after(() => { dom.window.close(); globalThis.fetch = originalFetch })

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { MotionConfig } = await import("motion/react")
const { I18nextProvider, initReactI18next } = await import("react-i18next")
const i18n = (await import("i18next")).createInstance()
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: {
  agentMessage: { view: { label: "Session view", chat: "Chat", terminal: "Terminal" } },
} } } })
const { AgentPreferencesProvider } = await import("../../../src/features/settings/agent-preferences-context.tsx")
const { AGENT_PREFERENCES_STORAGE_KEY } = await import("../../../src/features/settings/agent-preferences.ts")
const { HarnessProvider } = await import("../../../src/features/sidebar/header/harness-context.tsx")
const { SessionViewProvider, useSessionView } = await import("../../../src/features/agent-message/session-view-context.tsx")
const { SessionViewToggle } = await import("../../../src/features/agent-message/components/session-view-toggle.tsx")

async function mount(initial: SessionViewIdentity = { chatKey: "1", sessionId: null }) {
  dom.window.localStorage.clear()
  dom.window.localStorage.setItem(AGENT_PREFERENCES_STORAGE_KEY, JSON.stringify({ defaultHarness: "claude" }))
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  let value!: ReturnType<typeof useSessionView>
  function Probe() {
    value = useSessionView()
    return <SessionViewToggle />
  }
  const update = async (identity: SessionViewIdentity) => {
    await act(async () => root.render(<React.StrictMode><I18nextProvider i18n={i18n}><MotionConfig reducedMotion="always">
      <AgentPreferencesProvider><HarnessProvider><SessionViewProvider {...identity}><Probe /></SessionViewProvider></HarnessProvider></AgentPreferencesProvider>
    </MotionConfig></I18nextProvider></React.StrictMode>))
  }
  await update(initial)
  return {
    value: () => value, update,
    chat: () => host.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Chat"]')!,
    terminal: () => host.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Terminal"]')!,
    close: async () => { await act(async () => root.unmount()); host.remove() },
  }
}

test("a draft cannot open Terminal by tab or programmatic request, and a confirmed session enables it", async () => {
  const view = await mount()
  try {
    assert.equal(view.terminal().getAttribute("aria-disabled"), "true")
    await act(async () => view.terminal().click())
    await act(async () => view.value().setView("terminal"))
    assert.equal(view.value().view, "chat")
    assert.equal(view.value().terminalOpened, false)
    assert.equal(view.chat().getAttribute("aria-selected"), "true")

    await view.update({ chatKey: "1", sessionId: "started" })
    assert.notEqual(view.terminal().getAttribute("aria-disabled"), "true")
    assert.equal(view.value().view, "chat")
    assert.equal(view.value().terminalOpened, false)
    await act(async () => view.terminal().click())
    assert.equal(view.value().view, "terminal")
    assert.equal(view.value().terminalOpened, true)
    await act(async () => view.chat().click())
    assert.equal(view.value().terminalOpened, true)
  } finally { await view.close() }
})

test("New conversation clears a previously opened terminal and does not reopen it when the next session starts", async () => {
  const view = await mount({ chatKey: "1", sessionId: "old" })
  try {
    await act(async () => view.terminal().click())
    await view.update({ chatKey: "2", sessionId: null })
    assert.equal(view.value().view, "chat")
    assert.equal(view.value().terminalOpened, false)
    assert.equal(view.terminal().getAttribute("aria-disabled"), "true")
    await act(async () => view.value().setView("terminal"))
    assert.equal(view.value().terminalOpened, false)
    await view.update({ chatKey: "2", sessionId: "next" })
    assert.equal(view.value().view, "chat")
    assert.equal(view.value().terminalOpened, false)
    assert.notEqual(view.terminal().getAttribute("aria-disabled"), "true")
  } finally { await view.close() }
})

test("native rebinding preserves Terminal, but closing the session resets it even without changing the chat key", async () => {
  const view = await mount({ chatKey: "1", sessionId: "old" })
  try {
    await act(async () => view.terminal().click())
    view.value().preserveViewForSession("cleared")
    await view.update({ chatKey: "1", sessionId: "cleared" })
    assert.equal(view.value().view, "terminal")
    assert.equal(view.value().terminalOpened, true)
    await view.update({ chatKey: "1", sessionId: null })
    assert.equal(view.value().view, "chat")
    assert.equal(view.value().terminalOpened, false)
    assert.equal(view.terminal().getAttribute("aria-disabled"), "true")
  } finally { await view.close() }
})
