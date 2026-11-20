import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"
import type { useAgentMessage } from "../../../src/features/agent-message/use-agent-message.ts"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" })
for (const key of ["window", "document", "navigator", "HTMLElement", "Event", "MessageEvent", "EventTarget"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const noop = () => {}
const fixture = {
  active: { runSessionId: "session" as string | null, runCwd: "/work", runMode: "agent" },
  harness: { runHarnessId: "claude" },
  thread: { threadMessages: [], messagesStatus: "loaded", transcriptEpoch: 0 },
  actions: { bindRunSession: (id: string): void => { fixture.active = { ...fixture.active, runSessionId: id } }, setRunModePending: noop },
  list: { refresh: noop },
  live: { beginLiveSession: noop, endLiveSession: noop },
  view: { preserveViewForSession: noop, setView: noop },
  uploads: { enqueueFiles: () => assert.fail("No uploads expected") },
}
Object.assign(globalThis, { dashboardConfigurationFixture: fixture })
const hooks = registerHooks({
  load(url, context, nextLoad) {
    let source: string | undefined
    if (url.endsWith("/features/chat-session/index.ts")) source = `
      const fixture = globalThis.dashboardConfigurationFixture;
      export const useActiveSession = () => fixture.active;
      export const useChatThread = () => fixture.thread;
      export const useChatSessionActions = () => fixture.actions;
      export const useSessionList = () => fixture.list;
      export const useLiveSessions = () => fixture.live;
    `
    if (url.endsWith("/harness-context.tsx")) source = "export const useHarness = () => globalThis.dashboardConfigurationFixture.harness"
    if (url.endsWith("/session-view-context.tsx")) source = "export const useSessionView = () => globalThis.dashboardConfigurationFixture.view"
    if (url.endsWith("/features/uploads/index.ts")) source = "export const useUploadQueue = () => globalThis.dashboardConfigurationFixture.uploads"
    return source === undefined ? nextLoad(url, context) : { format: "module", source, shortCircuit: true }
  },
})

class Socket extends EventTarget {
  static readonly OPEN = 1
  static readonly CONNECTING = 0
  static instances: Socket[] = []
  readyState = 0
  seq = 0
  sent: Record<string, unknown>[] = []
  constructor(readonly url: string) { super(); Socket.instances.push(this) }
  open() { this.readyState = 1; this.dispatchEvent(new Event("open")) }
  send(text: string) { this.sent.push(JSON.parse(text)) }
  frame(frame: Record<string, unknown>) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ v: 2, streamId: "stream", sessionId: fixture.active.runSessionId, seq: ++this.seq, ...frame }) }))
  }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")) }
  configurations() { return this.sent.filter((frame) => frame.type === "session.configure") }
}
Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: Socket })
const originalFetch = globalThis.fetch
globalThis.fetch = async (input) => {
  const url = String(input)
  if (url === "/api/sandbox/agent/profile") return Response.json({ queue_behavior: "follow-up" })
  if (url === "/api/sandbox/credentials/profiles") return Response.json({ profiles: [], default_profile_id: null })
  if (url.includes("/context")) return Response.json({ used: null, limit: null, categories: [] })
  assert.fail(`Unexpected request: ${url}`)
}
after(() => { hooks.deregister(); dom.window.close(); globalThis.fetch = originalFetch })

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { initReactI18next } = await import("react-i18next")
const i18n = (await import("i18next")).default
await i18n.use(initReactI18next).init({ lng: "en", resources: {} })
const { AgentPreferencesProvider } = await import("../../../src/features/settings/agent-preferences-context.tsx")
const { useAgentMessage: useMessage } = await import("../../../src/features/agent-message/use-agent-message.ts")
const { AGENT_PREFERENCES_STORAGE_KEY } = await import("../../../src/features/settings/agent-preferences.ts")
const { emptyContextUsage } = await import("../../../src/features/agent-message/context-usage.ts")
const config = { model: "model", profileId: "profile", effort: "medium", contextWindow: 200000, cwd: "/work", enabledPluginIds: [] as string[], context: emptyContextUsage() }

async function mount(options: { enabled?: boolean; harness?: "claude" | "pi"; draft?: boolean } = {}) {
  fixture.active = { ...fixture.active, runSessionId: options.draft ? null : "session" }
  fixture.harness = { runHarnessId: options.harness ?? "claude" }
  dom.window.localStorage.clear()
  dom.window.localStorage.setItem(AGENT_PREFERENCES_STORAGE_KEY, JSON.stringify({ enabledPluginIds: options.enabled ? ["agent-dashboard"] : [] }))
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  let state!: ReturnType<typeof useAgentMessage>
  function Probe() {
    state = useMessage()
    return <button aria-pressed={state.dashboardEnabled} onClick={() => state.setDashboardEnabled(!state.dashboardEnabled)}>Dashboard</button>
  }
  const render = () => root.render(<React.StrictMode><AgentPreferencesProvider><Probe /></AgentPreferencesProvider></React.StrictMode>)
  await act(async () => { render() })
  const socket = options.draft ? undefined : Socket.instances.at(-1)!
  await act(async () => {
    if (socket) {
      socket.open()
      socket.frame({ type: "session.snapshot", config: { ...config, enabledPluginIds: options.enabled ? ["agent-dashboard"] : [] }, tasks: [], messages: [] })
    } else state.setModelReference("profile:model")
  })
  return {
    state: () => state,
    socket,
    button: () => host.querySelector("button")!,
    stored: () => JSON.parse(dom.window.localStorage.getItem(AGENT_PREFERENCES_STORAGE_KEY)!).enabledPluginIds.includes("agent-dashboard"),
    toggle: async () => { await act(async () => host.querySelector("button")!.click()) },
    reply: async (frame: Record<string, unknown>) => { await act(async () => socket!.frame(frame)) },
    render: async () => { await act(async () => { render() }) },
    close: async () => { await act(async () => root.unmount()); host.remove() },
  }
}

for (const harness of ["claude", "pi"] as const) for (const enabled of [false, true]) {
  test(`${harness} failed ${enabled ? "disable" : "enable"} restores the switch and stored preference without retrying`, async () => {
    const view = await mount({ harness, enabled })
    try {
      await view.reply({ type: "run.started", runId: "current", driver: "terminal" })
      await view.toggle()
      const [request] = view.socket!.configurations()
      assert.deepEqual(request?.enabledPluginIds, !enabled ? ["agent-dashboard"] : [])
      assert.equal(view.button().getAttribute("aria-pressed"), String(enabled), "wait for the native configuration before changing the switch")
      assert.equal(view.state().configurationPending, true)
      await view.reply({ type: "error", code: "session.configure", requestId: request!.requestId, message: "Finish background tasks first" })
      assert.equal(view.button().getAttribute("aria-pressed"), String(enabled))
      assert.equal(view.stored(), enabled)
      assert.equal(view.state().configurationPending, false)
      assert.equal(view.state().connectionError, "Finish background tasks first")
      assert.equal(view.state().isStreaming, true, "the existing reply must keep running")
      assert.equal(view.socket!.configurations().length, 1, "rollback must not send another configuration")
      assert.equal(view.socket!.sent.some((frame) => frame.type === "run.abort"), false)
      assert.equal(view.socket!.readyState, Socket.OPEN)
    } finally { await view.close() }
  })
}

test("a successful choice becomes the rollback value for the next failed change", async () => {
  const view = await mount()
  try {
    await view.toggle()
    const first = view.socket!.configurations()[0]!
    await view.reply({ type: "session.config", requestId: first.requestId, config: { ...config, enabledPluginIds: ["agent-dashboard"] } })
    assert.equal(view.state().configurationPending, false)
    await view.toggle()
    const second = view.socket!.configurations()[1]!
    await view.reply({ type: "error", requestId: second.requestId, message: "Cannot disable" })
    assert.equal(view.state().dashboardEnabled, true)
    assert.equal(view.stored(), true)
    assert.equal(view.socket!.configurations().length, 2)
  } finally { await view.close() }
})

test("a second click while configuration is pending does not queue another request", async () => {
  const view = await mount()
  try {
    await view.toggle()
    await view.toggle()
    const [request] = view.socket!.configurations()
    assert.equal(view.socket!.configurations().length, 1)
    assert.equal(view.state().dashboardEnabled, false)
    assert.equal(view.state().configurationPending, true)
    await view.reply({ type: "session.config", requestId: request!.requestId, config: { ...config, enabledPluginIds: ["agent-dashboard"] } })
    assert.equal(view.state().dashboardEnabled, true)
    assert.equal(view.stored(), true)
  } finally { await view.close() }
})

test("a session snapshot replaces browser preferences with the actually loaded plugins", async () => {
  const view = await mount({ enabled: true })
  try {
    await view.reply({ type: "session.snapshot", config: { ...config, enabledPluginIds: [] }, tasks: [], messages: [] })
    assert.equal(view.state().dashboardEnabled, false)
    assert.equal(view.stored(), false)
    assert.equal(view.socket!.configurations().length, 0)
  } finally { await view.close() }
})

test("a failed configuration from a previous session does not roll back the next session", async () => {
  const view = await mount()
  try {
    await view.toggle()
    fixture.active = { ...fixture.active, runSessionId: "other-session" }
    await view.render()
    assert.equal(view.state().dashboardEnabled, false)
    assert.equal(view.stored(), false)
    assert.equal(view.state().configurationPending, false)
    assert.equal(view.state().connectionError, null)
  } finally { await view.close() }
})

test("a native session rebind keeps the rollback value of a pending configuration", async () => {
  const view = await mount()
  try {
    await view.toggle()
    const request = view.socket!.configurations()[0]!
    await view.reply({ type: "session.rebound", nextSessionId: "cleared-session" })
    assert.equal(view.state().dashboardEnabled, false)
    assert.equal(view.state().configurationPending, true)
    await view.reply({ type: "error", requestId: request.requestId, message: "Configuration failed after /clear" })
    assert.equal(view.state().dashboardEnabled, false)
    assert.equal(view.stored(), false)
    assert.equal(view.socket!.configurations().length, 1)
  } finally { await view.close() }
})

test("losing the connection before confirmation restores the last confirmed choice", async () => {
  const view = await mount()
  try {
    await view.toggle()
    await act(async () => view.socket!.close())
    assert.equal(view.state().dashboardEnabled, false)
    assert.equal(view.stored(), false)
    assert.equal(view.state().configurationPending, false)
    assert.match(view.state().connectionError!, /Connection lost/)
    assert.equal(view.socket!.configurations().length, 1)
  } finally { await view.close() }
})

test("a draft choice is saved locally and included in its first turn without configuring a session", async () => {
  const view = await mount({ draft: true })
  try {
    await view.toggle()
    assert.equal(view.state().dashboardEnabled, true)
    assert.equal(view.stored(), true)
    await act(async () => view.state().setDraft("Show a chart"))
    await act(async () => view.state().submit())
    const socket = Socket.instances.at(-1)!
    await act(async () => socket.open())
    assert.equal(socket.configurations().length, 0)
    assert.deepEqual(socket.sent.find((frame) => frame.type === "run.start")?.enabledPluginIds, ["agent-dashboard"])
  } finally { await view.close() }
})


for (const harness of ["claude", "pi"] as const) {
  test(`${harness} queued messages wait for plugin configuration and use its acknowledged selection`, async () => {
    const view = await mount({ harness, enabled: true })
    try {
      await view.reply({ type: "run.started", runId: "active", driver: "terminal" })
      await act(async () => view.state().setDraft("Follow up after the current reply"))
      await act(async () => view.state().submit())
      await view.toggle()
      const request = view.socket!.configurations()[0]!
      await view.reply({ type: "run.completed", runId: "active" })
      assert.equal(view.socket!.sent.filter((frame) => frame.type === "run.start").length, 0, "queued messages must wait for configuration acknowledgement")
      await view.reply({ type: "session.config", requestId: request.requestId, config: { ...config, enabledPluginIds: [] } })
      const started = view.socket!.sent.find((frame) => frame.type === "run.start")!
      assert.ok(started)
      assert.deepEqual(started.enabledPluginIds, [], "a queued turn must not restore its captured plugin selection")
      await view.reply({ type: "run.completed", runId: started.runId })
    } finally { await view.close() }
  })
}

for (const savedConfig of [undefined, { ...config, enabledPluginIds: [] }]) {
  test(`switching sessions waits for the snapshot and restores ${savedConfig ? "saved" : "default"} disabled plugins`, async () => {
    const view = await mount({ enabled: true })
    try {
      await act(async () => view.state().setDraft("A message for the other session"))
      fixture.active = { ...fixture.active, runSessionId: "other-session" }
      await view.render()
      const socket = Socket.instances.at(-1)!
      assert.equal(view.state().dashboardEnabled, false, "the prior session selection must not appear loaded")
      assert.equal(view.stored(), true, "waiting for a session must not erase the saved draft preference")
      assert.equal(view.state().canSubmit, false)
      await act(async () => { socket.open(); view.state().submit() })
      assert.equal(socket.sent.filter((frame) => frame.type === "run.start").length, 0)
      await act(async () => socket.frame({ type: "session.snapshot", ...(savedConfig ? { config: savedConfig } : {}), tasks: [], messages: [] }))
      assert.equal(view.state().dashboardEnabled, false)
      assert.equal(view.state().canSubmit, true)
      await act(async () => view.state().submit())
      const started = socket.sent.find((frame) => frame.type === "run.start")!
      assert.deepEqual(started.enabledPluginIds, [])
      await act(async () => socket.frame({ type: "run.completed", runId: started.runId }))
    } finally { await view.close() }
  })
}

test("a disconnected existing session keeps its confirmed switch but cannot dispatch stale configuration", async () => {
  const view = await mount({ enabled: true })
  try {
    await act(async () => view.state().setDraft("Wait for reconnect"))
    await act(async () => view.socket!.close())
    assert.equal(view.state().dashboardEnabled, true)
    assert.equal(view.state().canSubmit, false)
    await act(async () => view.state().submit())
    assert.equal(view.socket!.sent.some((frame) => frame.type === "run.start"), false)
  } finally { await view.close() }
})

test("Computer Use loads beside the dashboard after the runner confirms, and can be unloaded on its own", async () => {
  const view = await mount({ enabled: true })
  const stored = () => JSON.parse(dom.window.localStorage.getItem(AGENT_PREFERENCES_STORAGE_KEY)!).enabledPluginIds
  try {
    await act(async () => view.state().setComputerUseEnabled(true))
    const [request] = view.socket!.configurations()
    assert.deepEqual(request?.enabledPluginIds, ["agent-dashboard", "computer-use"])
    assert.equal(view.state().computerUseEnabled, false, "wait for the runner before showing the check")
    await view.reply({ type: "session.config", requestId: request!.requestId, config: { ...config, enabledPluginIds: ["agent-dashboard", "computer-use"] } })
    assert.equal(view.state().computerUseEnabled, true)
    assert.equal(view.state().dashboardEnabled, true)
    assert.deepEqual(stored(), ["agent-dashboard", "computer-use"])
    await act(async () => view.state().setComputerUseEnabled(false))
    assert.deepEqual(view.socket!.configurations()[1]?.enabledPluginIds, ["agent-dashboard"])
  } finally { await view.close() }
})

test("stored plugin preferences keep the product plugins and drop anything else", async () => {
  const { parseAgentPreferences } = await import("../../../src/features/settings/agent-preferences.ts")
  assert.deepEqual(parseAgentPreferences({ enabledPluginIds: ["computer-use", "retired-plugin", "agent-dashboard", "computer-use"] }).enabledPluginIds,
    ["agent-dashboard", "computer-use"])
  assert.deepEqual(parseAgentPreferences({ enabledPluginIds: "computer-use" }).enabledPluginIds, [])
})
