import type { MessageAttachment } from "./message-attachment"
import { messageTextWithAttachments } from "./message-attachment-text"
import { parseStreamFrame, type StreamFrame } from "./run-stream-reducer"

export type AgentRunHarness = "claude" | "pi"
export type AgentRunEffort = "low" | "medium" | "high" | "xhigh" | "max"
export type AgentRunInit = {
  text: string; attachments?: MessageAttachment[]; model: string; harness: AgentRunHarness
  cwd: string; effort?: AgentRunEffort; sessionId?: string; fork?: boolean; promptSuggestions?: boolean
}

type Handlers = {
  onFrame: (frame: StreamFrame) => void
  onError: (message: string) => void
  onConnection: (connected: boolean) => void
  onSession: (id: string) => void
}
type Waiter = { resolve: () => void; reject: (error: Error) => void; sentEpoch?: number }

export type AgentSessionConnection = ReturnType<typeof connectAgentSession>

/** Commands are sent once; reconnection only subscribes with the last session cursor. */
export function connectAgentSession(target: { harness: AgentRunHarness; sessionId?: string }, handlers: Handlers) {
  let sessionId = target.sessionId
  let socket: WebSocket
  let closed = false
  let retry: ReturnType<typeof setTimeout> | undefined
  let retryDelay = 300
  let connectionEpoch = 0
  let cursor: { streamId: string; seq: number } | undefined
  let activeRunId: string | undefined
  const pending = new Map<string, Waiter>()
  const idleWaiters: Array<() => void> = []
  const toolWaiters: Array<() => void> = []
  const tools = new Set<string>()
  const queued: Array<{ text: string; runId?: string }> = []

  const notifyIdle = () => {
    if (activeRunId || pending.size) return
    for (const resolve of idleWaiters.splice(0)) resolve()
  }
  const send = (frame: Record<string, unknown>) => {
    if (closed) throw new Error("Session connection is closed")
    const text = JSON.stringify(frame)
    const runId = frame.type === "run.start" ? String(frame.runId) : undefined
    if (socket.readyState === WebSocket.OPEN) {
      const waiter = runId ? pending.get(runId) : undefined
      if (waiter) waiter.sentEpoch = connectionEpoch
      socket.send(text)
    } else queued.push({ text, runId })
  }
  const connect = () => {
    const epoch = ++connectionEpoch
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    socket = new WebSocket(`${protocol}//${window.location.host}/api/sandbox/agent/ws/session`)
    socket.addEventListener("open", () => {
      retryDelay = 300
      handlers.onConnection(true)
      if (sessionId) socket.send(JSON.stringify({ type: "session.subscribe", harness: target.harness,
        sessionId, sinceSeq: cursor?.seq ?? 0, ...(cursor ? { streamId: cursor.streamId } : {}) }))
      for (const command of queued.splice(0)) {
        const waiter = command.runId ? pending.get(command.runId) : undefined
        if (waiter) waiter.sentEpoch = epoch
        socket.send(command.text)
      }
    })
    socket.addEventListener("message", (event) => {
      let raw: unknown
      try { raw = JSON.parse(String(event.data)) } catch { handlers.onError("Invalid agent frame"); return }
      const frame = parseStreamFrame(raw)
      if (!frame) return
      if (frame.sessionId && frame.sessionId !== sessionId) {
        sessionId = frame.sessionId
        handlers.onSession(sessionId)
      }
      if (frame.type === "replay.gap") { cursor = undefined; return }
      if (frame.streamId && frame.seq !== undefined) {
        if (frame.type !== "session.snapshot" && cursor?.streamId === frame.streamId && frame.seq <= cursor.seq) return
        cursor = { streamId: frame.streamId, seq: frame.seq }
      }
      if (frame.type === "session.snapshot") {
        activeRunId = frame.activeRunId
        // A fresh snapshot after restart is authoritative; do not retry an uncertain start.
        for (const [id, waiter] of epoch > 1 ? pending : []) {
          if (waiter.sentEpoch === undefined || waiter.sentEpoch >= epoch) continue
          const message = frame.messages?.find((item) => item.id === id)
          if (message?.status === "streaming" || id === activeRunId) continue
          pending.delete(id)
          if (message) waiter.resolve()
          else waiter.reject(new Error("The connection changed before the run could be confirmed"))
        }
      }
      if (frame.type === "run.started") activeRunId = frame.runId
      if (frame.type === "tool.started" && frame.id) tools.add(frame.id)
      if (frame.type === "tool.completed" && frame.id) tools.delete(frame.id)
      if (frame.type === "run.completed" || frame.type === "run.failed" || frame.type === "run.aborted") {
        if (activeRunId === frame.runId) activeRunId = undefined
        const waiter = frame.runId ? pending.get(frame.runId) : undefined
        if (frame.runId) pending.delete(frame.runId)
        waiter?.resolve()
        tools.clear()
      }
      if (frame.type === "error") {
        if (frame.code === "run.start" && frame.runId) {
          pending.get(frame.runId)?.reject(new Error(frame.message ?? "Agent request failed"))
          pending.delete(frame.runId)
        }
        handlers.onError(frame.message ?? "Agent request failed")
      }
      handlers.onFrame(frame)
      if (!tools.size) for (const resolve of toolWaiters.splice(0)) resolve()
      notifyIdle()
    })
    socket.addEventListener("close", () => {
      handlers.onConnection(false)
      if (closed) return
      if (!sessionId) {
        for (const waiter of pending.values()) waiter.reject(new Error("Disconnected before a session was confirmed; the request was not retried"))
        pending.clear()
        queued.length = 0
        notifyIdle()
        return
      }
      retry = setTimeout(connect, retryDelay)
      retryDelay = Math.min(5000, retryDelay * 2)
    })
  }
  connect()
  return {
    get sessionId() { return sessionId },
    start(init: AgentRunInit, runId: string): Promise<void> {
      return new Promise((resolve, reject) => {
        if (closed) { reject(new Error("Session connection is closed")); return }
        pending.set(runId, { resolve, reject })
        send({ ...init, attachments: undefined, text: messageTextWithAttachments(init.text, init.attachments),
          type: "run.start", runId, ...(sessionId ? { sessionId } : {}) })
      })
    },
    waitForIdle: () => activeRunId || pending.size ? new Promise<void>((resolve) => idleWaiters.push(resolve)) : Promise.resolve(),
    waitForTools: () => tools.size ? new Promise<void>((resolve) => toolWaiters.push(resolve)) : Promise.resolve(),
    abort: () => { if (sessionId) send({ type: "run.abort", harness: target.harness, sessionId, ...(activeRunId ? { runId: activeRunId } : {}) }) },
    stopTask: (taskId: string) => { if (sessionId) send({ type: "task.stop", harness: target.harness, sessionId, taskId }) },
    disconnect: () => {
      closed = true
      clearTimeout(retry)
      socket.close()
      for (const waiter of pending.values()) waiter.resolve()
      pending.clear(); activeRunId = undefined; tools.clear(); queued.length = 0
      for (const resolve of toolWaiters.splice(0)) resolve()
      notifyIdle()
    },
  }
}
