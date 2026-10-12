import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"
import type { AgentThreadMessage } from "../../../src/features/agent-message/agent-message-data.ts"
import type { StreamFrame } from "../../../src/features/agent-message/run-stream-reducer.ts"

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "localStorage", "HTMLElement", "Element", "Node", "DocumentFragment", "ShadowRoot", "SVGElement", "Event", "EventTarget", "MessageEvent", "MutationObserver", "getComputedStyle"]) {
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
  blocks: [{ type: "tool_use", id: "old-tool", blockId: "old-tool", index: 0, name: "mcp__computer__list_apps",
    tool: { id: "old-tool", name: "mcp__computer__list_apps", status: "completed", output: "done" } }],
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
  if (path.endsWith("/thread")) return Response.json({ messages: [{ ...history, created_at: history.createdAt, transcript_uuid: null }] })
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
const { WorkspaceFilesProvider, useOpenWorkspaceTab, useWorkspaceTab, useOptionalWorkspaceFiles } = await import("../../../src/features/workspace/workspace-files-context.tsx")
const { AgentPreferencesProvider } = await import("../../../src/features/settings/agent-preferences-context.tsx")
const { HarnessProvider } = await import("../../../src/features/sidebar/header/harness-context.tsx")
const { ChatSessionProvider, useChatSessionActions } = await import("../../../src/features/chat-session/chat-session-context.tsx")
const { SessionViewProvider } = await import("../../../src/features/agent-message/session-view-context.tsx")
const { UploadQueueContext } = await import("../../../src/features/uploads/upload-queue-context.ts")
const { useAgentMessage } = await import("../../../src/features/agent-message/use-agent-message.ts")

let controls: {
  agent: ReturnType<typeof useAgentMessage>
  actions: ReturnType<typeof useChatSessionActions>
  sidebar: ReturnType<typeof useSidebar>
  tabs: ReturnType<typeof useWorkspaceTab>
  files: ReturnType<typeof useOptionalWorkspaceFiles>
  openTab: ReturnType<typeof useOpenWorkspaceTab>
}
function Probe() {
  const openTab = useOpenWorkspaceTab()
  const onComputerToolStarted = React.useCallback(() => openTab("computer"), [openTab])
  const agent = useAgentMessage({ onComputerToolStarted })
  controls = { agent, actions: useChatSessionActions(), sidebar: useSidebar(), tabs: useWorkspaceTab(), files: useOptionalWorkspaceFiles(), openTab }
  return null
}

for (const [harness, width] of [["claude", 1280], ["pi", 390]] as const) test(`${harness} live computer calls open the ${width < 768 ? "mobile drawer" : "desktop panel"}, while history and replay do not`, async () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width })
  localStorage.clear()
  localStorage.setItem("agent-ui-agent-preferences", JSON.stringify({ defaultHarness: harness }))
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const opened = () => controls.sidebar.isMobile ? controls.sidebar.openMobile : controls.sidebar.open
  const closeWorkspace = () => controls.sidebar.isMobile ? controls.sidebar.setOpenMobile(false) : controls.sidebar.setOpen(false)
  try {
    await act(async () => root.render(<React.StrictMode><I18nextProvider i18n={i18n}>
      <AgentPreferencesProvider><HarnessProvider><ChatSessionProvider><SessionViewProvider chatKey="test" sessionId="session">
        <UploadQueueContext.Provider value={{ enqueueFiles: () => { throw new Error("Unexpected upload") } }}>
          <SidebarProvider defaultOpen={false} stateCookieName={false} widthCookieName={false} keyboardShortcut={false}>
            <WorkspaceFilesProvider><Probe /></WorkspaceFilesProvider>
          </SidebarProvider>
        </UploadQueueContext.Provider>
      </SessionViewProvider></ChatSessionProvider></HarnessProvider></AgentPreferencesProvider>
    </I18nextProvider></React.StrictMode>))
    await act(async () => controls.actions.openSession({ sessionId: "session", summary: "History", firstPrompt: null, customTitle: null,
      cwd: "/work", lastModified: 0, tag: null, tags: [], tagColors: {}, pinned: false, archived: false, runMode: "agent" }))
    assert.equal(controls.agent.messages[0]?.blocks?.[0]?.type, "tool_use", "HTTP history loaded")
    assert.equal(opened(), false)
    const socket = Socket.instances.at(-1)!
    assert.equal(socket.sent[0]?.harness, harness)
    await act(async () => socket.frame({ type: "session.snapshot", seq: 1, messages: [history], tasks: [], activeRunId: "old-run" }))
    const tool: StreamFrame = { type: "tool.started", runId: "run", id: "tool", messageId: "message", blockId: "tool", name: "mcp__computer__list_apps" }
    await act(async () => socket.frame({ ...tool, seq: 2, replay: true }))
    assert.equal(opened(), false, "running snapshots and replay do not navigate")

    await act(async () => socket.frame({ ...tool, id: "live", blockId: "live", seq: 3 }))
    assert.equal(opened(), true)
    assert.equal(controls.tabs.activeTabId, "computer")
    await act(async () => closeWorkspace())
    await act(async () => {
      socket.frame({ ...tool, id: "live", seq: 3 })
      socket.frame({ type: "tool.input_delta", id: "live", seq: 4, chunk: "{}" })
      socket.frame({ ...tool, seq: 5, name: "mcp__other__list_apps" })
    })
    assert.equal(opened(), false, "duplicates, input streaming and other servers do not reopen")
    await act(async () => socket.frame({ ...tool, id: "nested", blockId: "nested", seq: 6, parentToolUseId: "agent" }))
    assert.equal(opened(), true, "the next live subagent call reopens the panel")
    await act(async () => controls.files!.openFileInWorkspace("/work/file.txt"))
    assert.equal(controls.tabs.activeTabId, "files")
    assert.equal(controls.files?.pendingFilePath, "/work/file.txt")
    const openTab = controls.openTab
    await act(async () => controls.tabs.setActiveTabId("tasks"))
    assert.equal(controls.openTab, openTab, "navigation callback is independent of the selected tab")

    await act(async () => { socket.close(); await new Promise((resolve) => setTimeout(resolve, 350)) })
    const reconnected = Socket.instances.at(-1)!
    assert.notEqual(reconnected, socket)
    await act(async () => {
      reconnected.frame({ ...tool, seq: 7, replay: true })
      reconnected.frame({ type: "session.snapshot", seq: 8, messages: [history], tasks: [] })
      reconnected.frame({ ...tool, seq: 9, replay: true })
    })
    assert.equal(controls.tabs.activeTabId, "tasks", "replay cannot steal the selected tab, even around snapshots")
    await act(async () => reconnected.frame({ ...tool, id: "future", blockId: "future", seq: 10, name: "mcp__computer__future_tool" }))
    assert.equal(controls.tabs.activeTabId, "computer")
    assert.equal(opened(), true)
    assert.deepEqual(unexpected, [])
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
