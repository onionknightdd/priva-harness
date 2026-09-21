import type { AgentRunEffort } from "./run-agent-session"
import type { RunHarnessId } from "@/features/sidebar/header/harness-options"

/**
 * Client for `WS /api/sandbox/agent/ws/terminal`. Binary frames carry the
 * terminal byte stream in both directions; text frames carry the small JSON
 * control vocabulary. Lives outside React so the socket can stay open while
 * the view that renders it is hidden or re-rendered.
 */
export type TerminalSessionOptions = {
  harness: RunHarnessId
  cwd: string
  model: string
  sessionId?: string | null
  effort?: AgentRunEffort
  cols: number
  rows: number
  /** Viewer colour scheme; the runner aligns the TUI's own theme with it on launch. */
  theme?: "light" | "dark"
}

export type TerminalSessionStatus =
  | { phase: "connecting" }
  | { phase: "ready"; sessionId: string; adopted: boolean; cols: number; rows: number }
  | { phase: "exited"; reason: string }
  | { phase: "error"; kind: string; message: string }
  | { phase: "closed" }

export type TerminalSessionHandlers = {
  onOutput: (chunk: Uint8Array) => void
  onStatus: (status: TerminalSessionStatus) => void
}

export type TerminalSession = {
  send: (data: Uint8Array | string) => void
  resize: (cols: number, rows: number) => void
  close: () => void
}

export function terminalSocketUrl(options: TerminalSessionOptions): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  const params = new URLSearchParams({
    harness: options.harness,
    cwd: options.cwd,
    model: options.model,
    cols: String(options.cols),
    rows: String(options.rows),
  })
  if (options.sessionId) params.set("sessionId", options.sessionId)
  if (options.effort) params.set("effort", options.effort)
  if (options.theme) params.set("theme", options.theme)
  return `${protocol}//${window.location.host}/api/sandbox/agent/ws/terminal?${params.toString()}`
}

export function connectTerminalSession(
  options: TerminalSessionOptions,
  handlers: TerminalSessionHandlers
): TerminalSession {
  const socket = new WebSocket(terminalSocketUrl(options))
  socket.binaryType = "arraybuffer"
  let settled = false
  const settle = (status: TerminalSessionStatus) => {
    settled = true
    handlers.onStatus(status)
  }
  handlers.onStatus({ phase: "connecting" })
  socket.addEventListener("message", (event: MessageEvent<ArrayBuffer | string>) => {
    if (typeof event.data !== "string") {
      handlers.onOutput(new Uint8Array(event.data))
      return
    }
    const frame = parseControlFrame(event.data)
    if (!frame) return
    if (frame.type === "ready") {
      handlers.onStatus({ phase: "ready", sessionId: frame.sessionId, adopted: frame.adopted, cols: frame.cols, rows: frame.rows })
    } else if (frame.type === "exit") {
      settle({ phase: "exited", reason: frame.reason })
    } else {
      settle({ phase: "error", kind: frame.kind, message: frame.message })
    }
  })
  socket.addEventListener("close", () => {
    // A close after exit/error keeps that status; an unexpected drop
    // becomes "closed" so the view can offer a reconnect.
    if (!settled) settle({ phase: "closed" })
  })
  socket.addEventListener("error", () => {
    if (!settled) settle({ phase: "error", kind: "connection", message: "WebSocket connection failed" })
  })
  return {
    send: (data) => {
      if (socket.readyState !== WebSocket.OPEN) return
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data
      socket.send(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    },
    resize: (cols, rows) => {
      if (socket.readyState !== WebSocket.OPEN) return
      socket.send(JSON.stringify({ type: "resize", cols, rows }))
    },
    close: () => {
      settled = true
      socket.close()
    },
  }
}

type ControlFrame =
  | { type: "ready"; sessionId: string; adopted: boolean; cols: number; rows: number }
  | { type: "exit"; reason: string }
  | { type: "error"; kind: string; message: string }

export function parseControlFrame(text: string): ControlFrame | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== "object" || raw === null) return null
  const record = raw as Record<string, unknown>
  switch (record.type) {
    case "ready":
      if (typeof record.sessionId !== "string") return null
      return {
        type: "ready",
        sessionId: record.sessionId,
        adopted: record.adopted === true,
        cols: typeof record.cols === "number" ? record.cols : 0,
        rows: typeof record.rows === "number" ? record.rows : 0,
      }
    case "exit":
      return { type: "exit", reason: typeof record.reason === "string" ? record.reason : "" }
    case "error":
      return {
        type: "error",
        kind: typeof record.kind === "string" ? record.kind : "unknown",
        message: typeof record.message === "string" ? record.message : "",
      }
    default:
      return null
  }
}
