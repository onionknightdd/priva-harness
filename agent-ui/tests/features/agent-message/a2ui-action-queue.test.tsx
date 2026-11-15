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
  queue: "interrupt" as "interrupt" | "steer" | "follow-up",
  active: { runSessionId: "session" as string | null, runCwd: "/work", runMode: "agent" },
  harness: { runHarnessId: "claude" },
  thread: { threadMessages: [], messagesStatus: "loaded", transcriptEpoch: 0 },
  actions: { bindRunSession: (id: string): void => { fixture.active = { ...fixture.active, runSessionId: id } }, setRunModePending: noop },
  list: { refresh: noop },
  live: { beginLiveSession: noop, endLiveSession: noop },
  view: { preserveViewForSession: noop, setView: noop },
  uploads: { enqueueFiles: () => assert.fail("No uploads expected") },
}
Object.assign(globalThis, { a2uiActionQueueFixture: fixture })
const hooks = registerHooks({
  load(url, context, nextLoad) {
    let source: string | undefined
    if (url.endsWith("/features/chat-session/index.ts")) source = `
      const fixture = globalThis.a2uiActionQueueFixture;
      export const useActiveSession = () => fixture.active;
      export const useChatThread = () => fixture.thread;
      export const useChatSessionActions = () => fixture.actions;
      export const useSessionList = () => fixture.list;
      export const useLiveSessions = () => fixture.live;
    `
    if (url.endsWith("/harness-context.tsx")) source = "export const useHarness = () => globalThis.a2uiActionQueueFixture.harness"
    if (url.endsWith("/session-view-context.tsx")) source = "export const useSessionView = () => globalThis.a2uiActionQueueFixture.view"
    if (url.endsWith("/features/uploads/index.ts")) source = "export const useUploadQueue = () => globalThis.a2uiActionQueueFixture.uploads"
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
  starts() { return this.sent.filter((frame) => frame.type === "run.start") }
  aborts() { return this.sent.filter((frame) => frame.type === "run.abort") }
}
Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: Socket })
const originalFetch = globalThis.fetch
globalThis.fetch = async (input) => {
  const url = String(input)
  if (url === "/api/sandbox/agent/profile") return Response.json({ queue_behavior: fixture.queue })
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
const { emptyContextUsage } = await import("../../../src/features/agent-message/context-usage.ts")
const config = { model: "model", profileId: "profile", effort: "medium", contextWindow: 200000, cwd: "/work", enabledPluginIds: [], context: emptyContextUsage() }

const { uiActionMessage, parseUiActionMessage } = await import("../../../src/features/agent-message/ui-action.ts")
const actionPrompt = uiActionMessage({ messageId: "sales-reply", embedId: "sales-ui" }, {
  name: "view_region", surfaceId: "main", sourceComponentId: "region-button",
  timestamp: "2026-11-15T00:00:00Z", context: { region: "Europe", quarter: "Q3" },
  userMessage: "Show the European sales report",
})

async function mount(harness: "claude" | "pi", queue: typeof fixture.queue) {
  fixture.queue = queue
  fixture.active = { ...fixture.active, runSessionId: "session" }
  fixture.harness = { runHarnessId: harness }
  dom.window.localStorage.clear()
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  let state!: ReturnType<typeof useAgentMessage>
  function Probe() { state = useMessage(); return null }
  await act(async () => root.render(<React.StrictMode><AgentPreferencesProvider><Probe /></AgentPreferencesProvider></React.StrictMode>))
  const socket = Socket.instances.at(-1)!
  await act(async () => { socket.open(); socket.frame({ type: "session.snapshot", config, tasks: [], messages: [] }) })
  return {
    state: () => state, socket,
    reply: async (frame: Record<string, unknown>) => { await act(async () => socket.frame(frame)) },
    close: async () => { await act(async () => root.unmount()); host.remove() },
  }
}

for (const harness of ["claude", "pi"] as const) for (const queue of ["interrupt", "steer"] as const) {
  test(`${harness} normal ${queue} can stop an action run while its completion promise is pending`, async () => {
    const view = await mount(harness, queue)
    let actionDone = false
    let completion!: Promise<void>
    try {
      await act(async () => { completion = view.state().sendFollowUp(actionPrompt); void completion.then(() => { actionDone = true }) })
      const first = view.socket.starts()[0]!
      assert.ok(first)
      assert.equal(first.text, actionPrompt)
      assert.equal(parseUiActionMessage(String(first.text))?.uiAction.action.context.region, "Europe")
      assert.equal(view.state().messages.find((message) => message.role === "user")?.content, "Show the European sales report")
      await view.reply({ type: "run.started", runId: first.runId, driver: harness === "claude" ? "terminal" : "sdk" })
      await view.reply({ type: "tool.started", runId: first.runId, id: "active-tool", name: "read", input: {} })
      assert.equal(actionDone, false)
      await act(async () => view.state().setDraft("Change the report to Asia Pacific"))
      await act(async () => view.state().submit())
      if (queue === "steer") {
        assert.equal(view.socket.aborts().length, 0, "steer must still wait for active tools")
        await view.reply({ type: "tool.completed", runId: first.runId, id: "active-tool", name: "read", ok: true, output: "done" })
      }
      assert.equal(view.socket.aborts().length, 1, "ordinary Send must be able to abort before the action run completes")
      assert.equal(actionDone, false, "button completion must remain pending until the run is acknowledged as ended")
      assert.equal(view.socket.starts().length, 1, "the replacement turn must wait for the abort acknowledgment")
      await view.reply({ type: "run.aborted", runId: first.runId })
      await completion
      assert.equal(actionDone, true)
      assert.equal(view.socket.starts().length, 2)
      assert.equal(view.socket.starts()[1].text, "Change the report to Asia Pacific")
      await view.reply({ type: "run.completed", runId: view.socket.starts()[1].runId })
    } finally { await view.close() }
  })
}

test("follow-up mode waits for an action run without aborting it", async () => {
  const view = await mount("pi", "follow-up")
  let completion!: Promise<void>
  try {
    await act(async () => { completion = view.state().sendFollowUp(actionPrompt) })
    const first = view.socket.starts()[0]!
    await view.reply({ type: "run.started", runId: first.runId })
    await act(async () => view.state().setDraft("Add a comparison with last year"))
    await act(async () => view.state().submit())
    assert.equal(view.socket.aborts().length, 0)
    assert.equal(view.socket.starts().length, 1)
    await view.reply({ type: "run.completed", runId: first.runId })
    await completion
    assert.equal(view.socket.starts().length, 2)
    await view.reply({ type: "run.completed", runId: view.socket.starts()[1].runId })
  } finally { await view.close() }
})


for (const harness of ["claude", "pi"] as const) {
  test(`${harness} queued A2UI actions use the plugin selection acknowledged after the active reply`, async () => {
    const view = await mount(harness, "follow-up")
    let completion!: Promise<void>
    try {
      await view.reply({ type: "session.config", config: { ...config, enabledPluginIds: ["agent-dashboard"] } })
      await view.reply({ type: "run.started", runId: "active" })
      await act(async () => { completion = view.state().sendFollowUp(actionPrompt) })
      await act(async () => view.state().setDashboardEnabled(false))
      const request = view.socket.sent.find((frame) => frame.type === "session.configure")!
      await view.reply({ type: "run.completed", runId: "active" })
      assert.equal(view.socket.starts().length, 0)
      await view.reply({ type: "session.config", requestId: request.requestId, config: { ...config, enabledPluginIds: [] } })
      const started = view.socket.starts()[0]!
      assert.ok(started)
      assert.deepEqual(started.enabledPluginIds, [])
      assert.equal(started.text, actionPrompt)
      await view.reply({ type: "run.completed", runId: started.runId })
      await completion
    } finally { await view.close() }
  })
}
