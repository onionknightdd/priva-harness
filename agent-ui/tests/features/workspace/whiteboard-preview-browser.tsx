import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { TooltipProvider } from "../../../src/components/ui/tooltip"
import { SidebarProvider } from "../../../src/components/ui/sidebar"
import { AgentPreferencesProvider } from "../../../src/features/settings/agent-preferences-context"
import { HarnessProvider } from "../../../src/features/sidebar/header/harness-context"
import { ChatSessionProvider, useActiveSession, useChatSessionActions } from "../../../src/features/chat-session"
import { WorkspaceFilesProvider, useWorkspaceTab } from "../../../src/features/workspace/workspace-files-context"
import { WorkspaceWhiteboardProvider } from "../../../src/features/workspace/workspace-whiteboard-context"
import { WorkspaceWhiteboardView } from "../../../src/features/workspace/views/workspace-whiteboard-view"
import { CanvasToolItem } from "../../../src/features/agent-message/components/canvas-tool-item"
import type { StreamBlock } from "../../../src/features/agent-message/agent-message-data"
import type { Board } from "../../../src/features/whiteboard/whiteboard-model"
import i18n from "../../../src/i18n"
import "../../../src/index.css"

const query = new URLSearchParams(location.search)
const expectFailure = query.has("failure")
document.documentElement.classList.toggle("dark", query.has("dark"))
await i18n.changeLanguage(query.has("zh") ? "zh-CN" : "en")
const sessionId = "preview-fixture"
const boardPath = `/fixture/.whiteboard/${sessionId}/preview.board.json`
const unexpected: string[] = []
const board: Board = { v: 1, title: "Isolated preview", revision: 1, order: ["note"], elements: {
  note: { type: "shape", kind: "rounded", x: 40, y: 40, w: 260, h: 120, text: "Whiteboard preview loaded", color: "blue" },
} }
// All application data is local to this page; imports still use the actual Vite
// module graph so a blocked dependency exercises the production lazy boundary.
window.fetch = async input => {
  const path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname
  if (path === "/api/sandbox/agent/profile") return Response.json({ queue_behavior: "follow-up" })
  if (path === "/api/sandbox/credentials/profiles") return Response.json({ default_profile_id: null, profiles: [] })
  if (path === "/api/sandbox/agent/sessions/running") return Response.json({ running: [], warm: [] })
  if (path === "/api/sandbox/agent/sessions") return Response.json({ active_cwd: "/fixture", groups: [] })
  if (path === `/api/sandbox/agent/sessions/${sessionId}/thread`) return Response.json({ run_mode: "agent", messages: [] })
  if (path.endsWith("/context-usage")) return Response.json(null)
  if (path === "/api/sandbox/whiteboards/list") return Response.json({ files: [{ name: "preview.board.json", path: boardPath }] })
  unexpected.push(path)
  throw new Error(`Unexpected fixture request: ${path}`)
}
class FixtureSocket extends EventTarget {
  static OPEN = 1
  readyState = 0
  constructor(address: string | URL) {
    super()
    const url = new URL(address, location.href)
    if (url.pathname !== "/api/sandbox/whiteboards/stream" || url.searchParams.get("path") !== boardPath) {
      unexpected.push(url.href)
      throw new Error(`Unexpected fixture WebSocket: ${url.href}`)
    }
    queueMicrotask(() => {
      if (this.readyState === 3) return
      this.readyState = 1
      this.dispatchEvent(new Event("open"))
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "snapshot", board }) }))
    })
  }
  send(text: string) {
    if (JSON.parse(text).type !== "context") throw new Error("Preview checks must not write to a whiteboard")
  }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")) }
}
Object.defineProperty(window, "WebSocket", { configurable: true, value: FixtureSocket })
const tool: Extract<StreamBlock, { type: "tool_use" }> = {
  type: "tool_use", id: "whiteboard-tool", blockId: "whiteboard-tool", name: "whiteboard_write", index: 0,
  tool: { id: "whiteboard-tool", name: "whiteboard_write", status: "completed", ok: true, input: { path: "preview.board.json" }, output: JSON.stringify({ path: boardPath }) },
}
export function PreviewFixture() {
  const { openSession } = useChatSessionActions()
  const { runSessionId } = useActiveSession()
  const { activeTabId } = useWorkspaceTab()
  const [clicks, setClicks] = useState(0)
  useEffect(() => {
    const frame = requestAnimationFrame(() => openSession({ sessionId, summary: "Isolated preview checks", firstPrompt: null, customTitle: null, cwd: "/fixture", lastModified: 0, tag: null, tags: [], tagColors: {}, pinned: false, archived: false, runMode: "agent" }))
    return () => cancelAnimationFrame(frame)
  }, [openSession])
  return <main className="mx-auto grid max-w-5xl gap-4 p-4 md:grid-cols-2" data-ready={runSessionId === sessionId}>
    <section data-chat className="min-w-0 space-y-4">
      <p>Chat remains available while the workspace loads.</p>
      <CanvasToolItem block={tool} />
      <button id="chat-action" className="rounded-md border px-3 py-2" onClick={() => setClicks(value => value + 1)}>Chat action: {clicks}</button>
    </section>
    <section data-workspace style={{ height: 480 }} className="flex min-w-0 flex-col rounded-md border">
      {activeTabId === "whiteboard" ? <WorkspaceWhiteboardView /> : <p className="p-4">Workspace closed</p>}
    </section>
  </main>
}
createRoot(document.querySelector("#root")!).render(<StrictMode><TooltipProvider>
  <AgentPreferencesProvider><HarnessProvider><ChatSessionProvider>
    <SidebarProvider className="block min-h-0" defaultOpen={false} stateCookieName={false} widthCookieName={false} keyboardShortcut={false}>
      <WorkspaceFilesProvider><WorkspaceWhiteboardProvider><PreviewFixture /></WorkspaceWhiteboardProvider></WorkspaceFilesProvider>
    </SidebarProvider>
  </ChatSessionProvider></HarnessProvider></AgentPreferencesProvider>
</TooltipProvider></StrictMode>)

async function until(condition: () => boolean, message: string) {
  const deadline = performance.now() + 10000
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(message)
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }
}
document.querySelector<HTMLButtonElement>("#run")!.addEventListener("click", async event => {
  const button = event.currentTarget as HTMLButtonElement
  const results = document.querySelector("#results")!
  button.disabled = true
  results.textContent = "Running…"
  let count = 0
  const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); count++ }
  try {
    await until(() => !!document.querySelector('[data-ready="true"]'), "Real session providers did not initialize")
    const chat = document.querySelector<HTMLElement>("[data-chat]")!
    const action = chat.querySelector<HTMLButtonElement>("#chat-action")!
    const initialText = action.textContent
    const toolButton = chat.querySelector<HTMLButtonElement>('[data-tool-status="success"]')!
    check(toolButton.getAttribute("aria-label") === i18n.t("agentMessage.canvasOpenPreview"), "Real whiteboard tool preview action is missing")
    check(!document.querySelector("[data-workspace-whiteboard]"), "The workspace opened before clicking the tool")
    toolButton.click()
    await until(() => !!document.querySelector("[data-workspace-whiteboard]"), "Clicking the tool did not select the whiteboard workspace tab")
    if (expectFailure) {
      // Run with renderer.tsx blocked in DevTools / Playwright. Do not substitute
      // a fake component: this must reject the real React.lazy import promise.
      await until(() => !!document.querySelector('[data-workspace] [role="alert"]'), "A rejected renderer import did not show a local error alert")
      const alert = document.querySelector('[data-workspace] [role="alert"]')!
      check(alert.textContent?.includes(i18n.t("whiteboard.loadFailed")), "Whiteboard failure message is not localized")
      const reload = [...document.querySelectorAll<HTMLButtonElement>("[data-workspace] button")].find(element => element.textContent === i18n.t("whiteboard.reloadPage"))
      check(reload && !reload.disabled, "Localized reload-page action is missing")
      check(!alert.textContent?.includes("TypeError"), "Raw module error leaked into the user-facing fallback")
    } else {
      await until(() => !!document.querySelector('.react-flow__node[data-id="note"]'), "Real whiteboard renderer did not load its isolated snapshot")
      check(document.querySelector('.react-flow__node[data-id="note"]')?.textContent?.includes("Whiteboard preview loaded"), "Normal preview did not render its content")
      const rect = document.querySelector('.react-flow__node[data-id="note"]')!.getBoundingClientRect()
      check(rect.width > 1 && rect.height > 1, "Loaded whiteboard content has no visible geometry")
      check(!document.querySelector('[data-workspace] [role="alert"]'), "Normal preview incorrectly shows the module failure fallback")
    }
    check(document.querySelector("[data-chat]") === chat, "A renderer failure remounted or removed the chat sibling")
    action.click()
    await until(() => action.textContent !== initialText, "Chat stopped responding after opening the whiteboard")
    check(action.isConnected, "Chat action was detached from the page")
    check(document.documentElement.scrollWidth <= innerWidth, "Preview or fallback overflows the page")
    check(unexpected.length === 0, `Unexpected application request: ${unexpected.join(", ")}`)
    results.textContent = `PASS (${count}) ${expectFailure ? "failed import isolated; chat still responds" : "real preview loaded; chat still responds"}`
  } catch (error) {
    results.textContent = `FAIL after ${count} checks\n${error instanceof Error ? error.stack : String(error)}`
  } finally { button.disabled = false }
})
