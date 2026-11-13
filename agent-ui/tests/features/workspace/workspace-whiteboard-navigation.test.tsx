import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"
import type { AgentThreadMessage } from "../../../src/features/agent-message/agent-message-data.ts"
import type { StreamFrame } from "../../../src/features/agent-message/run-stream-reducer.ts"

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "localStorage", "HTMLElement", "Element", "Node", "DocumentFragment", "ShadowRoot", "SVGElement", "Event", "EventTarget", "AbortController", "AbortSignal", "MessageEvent", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})
dom.window.matchMedia = (query) => ({ matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, onchange: null })
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) return { format: "module", source: "export default {}", shortCircuit: true }
    if (url.endsWith(".svg")) return { format: "module", source: `export default ${JSON.stringify(url)}`, shortCircuit: true }
    return nextLoad(url, context)
  },
})
const history: AgentThreadMessage = {
  id: "old-run", role: "assistant", content: "", createdAt: "2026-10-12T00:00:00Z", status: "complete",
  blocks: [{ type: "tool_use", id: "old-tool", blockId: "old-tool", index: 0, name: "mcp__agentWorkshop__whiteboard_write",
    tool: { id: "old-tool", name: "mcp__agentWorkshop__whiteboard_write", status: "completed", output: '{"path":"/work/.whiteboard/session/history.board.json"}', input: { path: "history.board.json", ops: "[]" } } }],
}
function sessionHistory(sessionId: string): AgentThreadMessage {
  return { ...history, blocks: [{ type: "tool_use", id: "old-tool", blockId: "old-tool", index: 0, name: "mcp__agentWorkshop__whiteboard_write",
    tool: { id: "old-tool", name: "mcp__agentWorkshop__whiteboard_write", status: "completed", input: { path: "history.board.json", ops: "[]" },
      output: JSON.stringify({ path: `/work/.whiteboard/${sessionId}/history.board.json` }) } }] }
}
const originalFetch = globalThis.fetch
const originalSocket = globalThis.WebSocket
const unexpected: string[] = []
globalThis.fetch = async (input) => {
  const path = new URL(String(input), dom.window.location.href).pathname
  if (path === "/api/sandbox/agent/profile") return Response.json({ queue_behavior: "follow-up" })
  if (path === "/api/sandbox/credentials/profiles") return Response.json({ default_profile_id: null, profiles: [] })
  if (path === "/api/sandbox/agent/sessions/running") return Response.json({ running: [], warm: [] })
  if (path === "/api/sandbox/agent/sessions") return Response.json({ active_cwd: "/work", groups: [] })
  if (path.endsWith("/thread")) return Response.json({ messages: [{ ...sessionHistory(path.split("/").at(-2)!), created_at: history.createdAt, transcript_uuid: null }] })
  if (path.endsWith("/context-usage")) return Response.json(null)
  unexpected.push(path)
  throw new Error(`Unexpected request: ${path}`)
}
class Socket extends EventTarget {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 0
  sent: Record<string, unknown>[] = []
  constructor() {
    super()
    Socket.instances.push(this)
    queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")) })
  }
  send(text: string) { this.sent.push(JSON.parse(text)) }
  frame(frame: StreamFrame) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ v: 2, streamId: "stream", sessionId: "session", ...frame }) }))
  }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")) }
}
Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: Socket })
after(() => { hooks.deregister(); globalThis.fetch = originalFetch; globalThis.WebSocket = originalSocket; dom.window.close() })

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { I18nextProvider, initReactI18next } = await import("react-i18next")
const i18n = (await import("i18next")).createInstance()
await i18n.use(initReactI18next).init({ lng: "en", resources: {} })
const { SidebarProvider, useSidebar } = await import("../../../src/components/ui/sidebar.tsx")
const { WorkspaceFilesProvider, useWorkspaceTab } = await import("../../../src/features/workspace/workspace-files-context.tsx")
const { AgentPreferencesProvider } = await import("../../../src/features/settings/agent-preferences-context.tsx")
const { HarnessProvider, useHarness } = await import("../../../src/features/sidebar/header/harness-context.tsx")
const { ChatSessionProvider, useChatSessionActions, useActiveSession, useChatThread } = await import("../../../src/features/chat-session/chat-session-context.tsx")
const { SessionViewProvider } = await import("../../../src/features/agent-message/session-view-context.tsx")
const { UploadQueueContext } = await import("../../../src/features/uploads/upload-queue-context.ts")
const { useAgentMessage } = await import("../../../src/features/agent-message/use-agent-message.ts")

const { WorkspaceWhiteboardProvider, useWorkspaceWhiteboard, useWhiteboardHistory, whiteboardScope, latestWhiteboardActivity } = await import("../../../src/features/workspace/workspace-whiteboard-context.tsx")
const { CanvasToolItem } = await import("../../../src/features/agent-message/components/canvas-tool-item.tsx")

test("history recovery requires a named board in the selected session", () => {
  const inputOnly = (input: unknown): AgentThreadMessage => ({ ...history, blocks: [{ type: "tool_use", id: "input-only", blockId: "input-only", index: 0, name: "whiteboard_write", input }] })
  assert.equal(latestWhiteboardActivity([inputOnly({ path: "sub/system-design.board.json" })], "/work", "second-session")?.path, "/work/.whiteboard/second-session/sub/system-design.board.json")
  assert.equal(latestWhiteboardActivity([history], "/work", "second-session"), null, "another session's canonical result is not restored")
  assert.equal(latestWhiteboardActivity([history], "/work", undefined), null, "drafts do not guess a session directory")
  assert.equal(latestWhiteboardActivity([inputOnly({ ops: "[]" })], "/work", "session"), null, "missing filenames do not restore a default board")
  assert.equal(latestWhiteboardActivity([inputOnly({ path: ".canvas/old.board.json" })], "/work", "session"), null, "the old directory has no compatibility path")
})

let controls: {
  agent: ReturnType<typeof useAgentMessage>
  actions: ReturnType<typeof useChatSessionActions>
  sidebar: ReturnType<typeof useSidebar>
  tabs: ReturnType<typeof useWorkspaceTab>
  boards: ReturnType<typeof useWorkspaceWhiteboard>
  scope: string
}
function Probe() {
  const boards = useWorkspaceWhiteboard()
  const { runHarnessId } = useHarness()
  const { runSessionId, runCwd } = useActiveSession()
  const scope = whiteboardScope(runHarnessId, runSessionId, runCwd)
  const onWhiteboardToolActivity = React.useCallback((activity: { sessionId: string | null; cwd: string; path: string; focus: boolean; animateInitial: boolean }) => {
    if (runHarnessId) boards?.open(whiteboardScope(runHarnessId, activity.sessionId, activity.cwd), activity.path, activity.focus, activity.animateInitial)
  }, [boards, runHarnessId])
  const agent = useAgentMessage({ onWhiteboardToolActivity })
  useWhiteboardHistory(useChatThread().threadMessages, scope, runCwd, runSessionId)
  controls = { agent, actions: useChatSessionActions(), sidebar: useSidebar(), tabs: useWorkspaceTab(), boards, scope }
  const block = sessionHistory(runSessionId ?? "unknown").blocks?.[0]
  return block?.type === "tool_use" ? <CanvasToolItem block={block} /> : null
}

for (const [harness, width] of [["claude", 1280], ["pi", 390]] as const) test(`${harness} live whiteboard navigation uses events without replay or history stealing focus`, async () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width })
  localStorage.clear()
  localStorage.setItem("agent-ui-agent-preferences", JSON.stringify({ defaultHarness: harness }))
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const opened = () => controls.sidebar.isMobile ? controls.sidebar.openMobile : controls.sidebar.open
  const closeWorkspace = () => controls.sidebar.isMobile ? controls.sidebar.setOpenMobile(false) : controls.sidebar.setOpen(false)
  const path = () => controls.boards?.paths[controls.scope]
  try {
    await act(async () => root.render(<React.StrictMode><I18nextProvider i18n={i18n}>
      <AgentPreferencesProvider><HarnessProvider><ChatSessionProvider><SessionViewProvider chatKey="test" sessionId="session">
        <UploadQueueContext.Provider value={{ enqueueFiles: () => { throw new Error("Unexpected upload") } }}>
          <SidebarProvider defaultOpen={false} stateCookieName={false} widthCookieName={false} keyboardShortcut={false}>
            <WorkspaceFilesProvider><WorkspaceWhiteboardProvider><Probe /></WorkspaceWhiteboardProvider></WorkspaceFilesProvider>
          </SidebarProvider>
        </UploadQueueContext.Provider>
      </SessionViewProvider></ChatSessionProvider></HarnessProvider></AgentPreferencesProvider>
    </I18nextProvider></React.StrictMode>))
    await act(async () => controls.actions.openSession({ sessionId: "session", summary: "History", firstPrompt: null, customTitle: null,
      cwd: "/work", lastModified: 0, tag: null, tags: [], tagColors: {}, pinned: false, archived: false, runMode: "agent" }))
    assert.equal(path(), "/work/.whiteboard/session/history.board.json", "history restores the board silently")
    assert.equal(opened(), false)
    const socket = Socket.instances.at(-1)!
    assert.equal(socket.sent[0]?.harness, harness)
    let seq = 0
    const frame = async (value: StreamFrame) => act(async () => socket.frame({ ...value, seq: ++seq }))
    await frame({ type: "session.snapshot", messages: [history], tasks: [], activeRunId: "old-run" })
    await frame({ type: "tool.started", id: "replay", name: "whiteboard_write", input: { path: "replayed.board.json", ops: "[]" }, replay: true })
    await frame({ type: "tool.completed", id: "replay", name: "whiteboard_write", output: '{"path":"/work/.whiteboard/session/replayed.board.json"}' })
    assert.equal(opened(), false, "a historical call finishing live does not reopen Workspace")
    const started: StreamFrame = { type: "tool.started", runId: "live-run", id: "live", blockId: "live", messageId: "live-message", name: "mcp__agentWorkshop__whiteboard_write", input: {} }
    await frame(started)
    assert.equal(opened(), false, "empty started input has no board path")
    await frame({ type: "tool.input_delta", id: "live", chunk: '{"path":"live.board.json",' })
    assert.equal(opened(), false, "partial arguments do not navigate")
    await frame({ type: "tool.input_delta", id: "live", chunk: '"ops":"[]"}' })
    assert.equal(opened(), true)
    assert.equal(controls.tabs.activeTabId, "whiteboard")
    assert.equal(path(), "/work/.whiteboard/session/live.board.json")
    assert.equal(controls.boards?.live[controls.scope], true)
    await act(async () => { closeWorkspace(); controls.tabs.setActiveTabId("tasks") })
    await frame({ type: "tool.running", id: "live", name: "whiteboard_write" })
    await frame({ type: "tool.completed", id: "live", name: "whiteboard_write", output: '{"path":"/work/.whiteboard/session/live.board.json"}' })
    assert.equal(opened(), false, "completion does not refocus an already opened call")
    assert.equal(controls.tabs.activeTabId, "tasks")
    await frame({ ...started, id: "missing-path", blockId: "missing-path", input: { ops: "[]" } })
    await frame({ type: "tool.running", id: "missing-path", name: "whiteboard_write" })
    await frame({ type: "tool.completed", id: "missing-path", name: "whiteboard_write" })
    assert.equal(path(), "/work/.whiteboard/session/live.board.json", "omitted paths never choose a default board")
    assert.equal(opened(), false)
    await frame({ ...started, id: "topic", blockId: "topic", input: { path: "login-flow.board.json", ops: "[]" } })
    assert.equal(path(), "/work/.whiteboard/session/login-flow.board.json")
    assert.equal(opened(), true)
    await act(async () => { closeWorkspace(); controls.tabs.setActiveTabId("files") })
    await frame({ ...started, id: "read", blockId: "read", name: "whiteboard_read", input: { path: "history.board.json" } })
    await frame({ type: "tool.completed", id: "failure", name: "whiteboard_write", ok: false, input: { path: "failed.board.json" } })
    assert.equal(opened(), false, "read-only and failed tools do not auto-open")
    await frame({ type: "tool.completed", id: "result-only", name: "whiteboard_write", output: '{"path":"/work/.whiteboard/session/result.board.json"}' })
    assert.equal(path(), "/work/.whiteboard/session/result.board.json", "native completed results can open without a streamed input")
    await act(async () => { closeWorkspace(); controls.tabs.setActiveTabId("tasks") })
    await act(async () => { socket.close(); await new Promise(resolve => setTimeout(resolve, 350)) })
    const reconnected = Socket.instances.at(-1)!
    assert.notEqual(reconnected, socket)
    await act(async () => {
      reconnected.frame({ ...started, id: "reconnected", seq: ++seq, replay: true, input: { path: "replay.board.json" } })
      reconnected.frame({ type: "session.snapshot", seq: ++seq, messages: [history], runningToolIds: ["restored"] })
      reconnected.frame({ type: "run.started", seq: ++seq, runId: "old-run", replay: true })
      reconnected.frame({ type: "tool.completed", id: "restored", seq: ++seq, name: "whiteboard_write", output: '{"path":"/work/.whiteboard/session/restored.board.json"}' })
    })
    assert.equal(opened(), false)
    assert.equal(controls.tabs.activeTabId, "tasks")
    assert.equal(path(), "/work/.whiteboard/session/result.board.json", "history cannot replace the chosen board")
    const historicalCard = host.querySelector<HTMLButtonElement>('button[aria-label="agentMessage.canvasOpenPreview"]')
    assert.ok(historicalCard)
    await act(async () => historicalCard.click())
    assert.equal(opened(), true)
    assert.equal(controls.tabs.activeTabId, "whiteboard")
    assert.equal(path(), "/work/.whiteboard/session/history.board.json", "explicit historical card clicks still work")
    assert.equal(controls.boards?.live[controls.scope], false, "historical clicks do not animate the existing snapshot")
    await act(async () => { closeWorkspace(); controls.tabs.setActiveTabId("tasks") })
    await act(async () => controls.actions.openSession({ sessionId: "other-session", summary: "Second session", firstPrompt: null, customTitle: null,
      cwd: "/work", lastModified: 0, tag: null, tags: [], tagColors: {}, pinned: false, archived: false, runMode: "agent" }))
    assert.equal(path(), "/work/.whiteboard/other-session/history.board.json", "a second session silently restores its own board")
    assert.equal(opened(), false)
    const otherSocket = Socket.instances.at(-1)!
    await act(async () => otherSocket.frame({ ...started, id: "topic", sessionId: "other-session", seq: 1, input: { path: "login-flow.board.json", ops: "[]" } }))
    assert.equal(path(), "/work/.whiteboard/other-session/login-flow.board.json", "the same call id in a different session uses that session root")
    assert.equal(opened(), true)
    await act(async () => { closeWorkspace(); controls.tabs.setActiveTabId("tasks") })
    await act(async () => otherSocket.frame({ type: "tool.completed", id: "topic", sessionId: "other-session", seq: 2, name: "whiteboard_write",
      output: '{"path":"/work/.whiteboard/other-session/login-flow.board.json"}' }))
    assert.equal(opened(), false, "canonical completion matches the creation-time subscription")
    const otherCard = host.querySelector<HTMLButtonElement>('button[aria-label="agentMessage.canvasOpenPreview"]')
    assert.ok(otherCard)
    await act(async () => otherCard.click())
    assert.equal(path(), "/work/.whiteboard/other-session/history.board.json", "historical cards resolve in their active session")
    await act(async () => controls.actions.openSession({ sessionId: "session", summary: "History", firstPrompt: null, customTitle: null,
      cwd: "/work", lastModified: 0, tag: null, tags: [], tagColors: {}, pinned: false, archived: false, runMode: "agent" }))
    assert.equal(path(), "/work/.whiteboard/session/history.board.json", "switching back keeps the first session selection")
    assert.deepEqual(unexpected, [])
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
