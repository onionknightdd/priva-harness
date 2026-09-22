import * as React from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "next-themes"
import { MotionConfig } from "motion/react"
import { SessionTerminalView } from "../../../src/features/agent-message/components/session-terminal-view"
import App from "../../../src/App"
import { installProjectDirectoryFixtures } from "../project-directory/project-directory-fixtures"
import type { AgentThreadMessage } from "../../../src/features/agent-message/agent-message-data"
import i18n from "../../../src/i18n"
import "../../../src/index.css"

const options = new URLSearchParams(location.search)
const appMode = options.has("app")
if (appMode) installProjectDirectoryFixtures()
await i18n.changeLanguage(options.has("zh") ? "zh-CN" : "en")
const results = document.getElementById("results")!
let connections = 0
let subscriptions = 0
let seq = 0
let nativeRuns = 0
let activeRunId: string | undefined
let sessionId = appMode ? "new-session-1" : "terminal-regression"
const messages: AgentThreadMessage[] = []
const sockets: TerminalSocket[] = []
const summary = () => { results.textContent = `Terminal connections: ${connections}; bubble subscriptions: ${subscriptions}; messages: ${messages.length}` }

class TerminalSocket extends EventTarget {
  static readonly OPEN = 1
  static readonly CONNECTING = 0
  readyState = 0
  binaryType = "arraybuffer"
  readonly terminal: boolean
  subscribed = false
  input = ""
  constructor(readonly url: string) {
    super()
    sockets.push(this)
    this.terminal = new URL(url).pathname.endsWith("/terminal")
    if (this.terminal) connections++
    setTimeout(() => {
      if (this.readyState !== 0) return
      this.readyState = 1
      this.dispatchEvent(new Event("open"))
      if (this.terminal) {
        this.reply({ type: "ready", sessionId, adopted: connections > 2, cols: 100, rows: 30 })
        this.output("\x1b[?1000h\x1b[?1006h中文 TUI ready\r\n")
        for (const message of messages) this.output(`${message.role === "user" ? "> " : ""}${message.content}\r\n`)
      }
      summary()
    }, 50)
  }
  reply(value: Record<string, unknown>) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }))
  }
  output(text: string) {
    this.dispatchEvent(new MessageEvent("message", { data: new TextEncoder().encode(text).buffer }))
  }
  snapshot() {
    this.reply({ v: 2, type: "session.snapshot", streamId: "native-stream", sessionId, harness: "claude", runId: "", seq, ts: Date.now(), tasks: [], messages, activeRunId })
  }
  send(data: string | ArrayBuffer) {
    if (typeof data === "string") {
      const frame = JSON.parse(data) as { type: string; text?: string; runId?: string }
      if (frame.type === "session.subscribe") {
        this.subscribed = true
        subscriptions++
        this.snapshot()
        summary()
      }
      if (frame.type === "run.start" && frame.runId && frame.text) {
        if (!this.subscribed) { this.subscribed = true; subscriptions++; this.snapshot() }
        replyInTerminal(frame.text, frame.runId)
      }
      return
    }
    const text = new TextDecoder().decode(data)
    this.output(text.replaceAll("\r", "\r\n"))
    this.input += text
    if (!this.input.includes("\r")) return
    const content = this.input.split("\r")[0]!.replaceAll("\u001b[200~", "").replaceAll("\u001b[201~", "")
    this.input = ""
    replyInTerminal(content, `native-${++nativeRuns}`)
  }
  close() {
    this.readyState = 3
    this.dispatchEvent(new Event("close"))
  }
}

function broadcast(frame: Record<string, unknown>) {
  const event = { v: 2, streamId: "native-stream", sessionId, harness: "claude", seq: ++seq, ts: Date.now(), ...frame }
  for (const socket of sockets) if (socket.subscribed && socket.readyState === 1) socket.reply(event)
}

function replyInTerminal(content: string, runId: string) {
  if (content.trim() === "/clear") {
    broadcast({ type: "run.completed", runId, model: "fixture" })
    const nextSessionId = `cleared-${++nativeRuns}`
    broadcast({ type: "session.rebound", nextSessionId })
    sessionId = nextSessionId
    seq = 0
    messages.splice(0)
    activeRunId = undefined
    for (const socket of sockets) {
      if (socket.readyState !== 1) continue
      if (socket.terminal) {
        socket.reply({ type: "rebound", sessionId })
        socket.output("\x1b[2J\x1b[HClaude 已清空上下文\r\n")
      }
      if (socket.subscribed) socket.snapshot()
    }
    summary()
    return
  }
  const createdAt = new Date().toISOString()
  activeRunId = runId
  broadcast({ type: "run.started", runId, driver: "terminal", userMessage: {
    id: `${runId}:user`, role: "user", content, status: "complete", createdAt,
  } })
  setTimeout(() => {
    messages.push(
      { id: `u-${seq}`, role: "user", content, status: "complete", createdAt },
      { id: `a-${seq}`, role: "assistant", content: `TUI 回复：${content}`, status: "complete", createdAt },
    )
    for (const socket of sockets) {
      if (socket.readyState !== 1) continue
      if (socket.terminal) socket.output(`\r\n> ${content}\r\nTUI 回复：${content}\r\n`)
      if (socket.subscribed) socket.snapshot()
    }
    broadcast({ type: "run.completed", runId, model: "fixture", durationMs: 100 })
    activeRunId = undefined
    summary()
  }, 100)
}
Object.defineProperty(window, "WebSocket", { configurable: true, value: TerminalSocket })
Object.assign(document.getElementById("checks")!.style, { position: "fixed", inset: "0 0 auto", height: "70px", padding: "8px", zIndex: "100" })
const host = document.getElementById("root")!
Object.assign(host.style, { position: "fixed", inset: "80px 0 0", display: "flex", overflow: "hidden" })
createRoot(host).render(<React.StrictMode><MotionConfig reducedMotion={options.has("reduced-motion") ? "always" : "user"}><ThemeProvider attribute="class" forcedTheme={options.has("dark") ? "dark" : "light"}>
  {appMode ? <App /> : <SessionTerminalView harness="claude" cwd="/test" model="test:model" effort="medium" sessionId={sessionId} hidden={false} />}
</ThemeProvider></MotionConfig></React.StrictMode>)
document.getElementById("exit")!.onclick = () => {
  const socket = sockets.filter((socket) => socket.terminal && socket.readyState === 1).at(-1)!
  if (!socket) return
  socket.reply({ type: "exit", reason: "tmux session ended" })
  socket.close()
  setTimeout(() => {
    const button = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes(String(i18n.t("agentMessage.terminalView.reopen"))))!
    const bounds = button.getBoundingClientRect()
    const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    results.textContent = `${button.contains(hit) ? "PASS" : "FAIL"} reopen pointer target: ${hit?.tagName}`
  }, 250)
}
