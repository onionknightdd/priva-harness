import { parseStreamFrame, type StreamFrame } from "./run-stream-reducer"

const RUN_WEBSOCKET_PATH = "/api/sandbox/agent/ws/run"

export type AgentRunHarness = "claude" | "pi"

export type AgentRunEffort = "low" | "medium" | "high" | "xhigh" | "max"

export type AgentRunInit = {
  text: string
  model: string
  harness: AgentRunHarness
  cwd: string
  effort?: AgentRunEffort
  sessionId?: string
  fork?: boolean
  promptSuggestions?: boolean
}

type AgentRunHandlers = {
  signal: AbortSignal
  onFrame: (frame: StreamFrame) => void
  onError: (message: string) => void
  onSession?: (sessionId: string) => void
  onToolStarted?: (id: string) => void
  onToolCompleted?: (id: string) => void
}

export function runAgentSession(
  init: AgentRunInit,
  handlers: AgentRunHandlers
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(runWebsocketUrl())
    let settled = false
    let failedMessage: string | null = null
    let boundSessionId: string | null = null

    const finish = (error: Error | null) => {
      if (settled) {
        return
      }
      settled = true
      handlers.signal.removeEventListener("abort", onAbort)
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close()
      }
      if (boundSessionId) {
        handlers.onSession?.(boundSessionId)
      }
      if (error) {
        reject(error)
        return
      }
      resolve()
    }

    const onAbort = () => {
      finish(new DOMException("Aborted", "AbortError"))
    }

    handlers.signal.addEventListener("abort", onAbort, { once: true })

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          type: "init",
          text: init.text,
          model: init.model,
          harness: init.harness,
          cwd: init.cwd,
          ...(init.effort === undefined ? {} : { effort: init.effort }),
          ...(init.sessionId === undefined ? {} : { sessionId: init.sessionId }),
          ...(init.fork === true ? { fork: true } : {}),
          ...(init.promptSuggestions === undefined
            ? {}
            : { promptSuggestions: init.promptSuggestions }),
        })
      )
    })

    socket.addEventListener("message", (event) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(event.data)) as unknown
      } catch {
        failedMessage = "Invalid agent frame"
        socket.close()
        return
      }

      const frame = parseStreamFrame(parsed)
      if (frame === undefined) {
        return
      }

      handlers.onFrame(frame)

      if (
        typeof frame.sessionId === "string" &&
        frame.sessionId !== "" &&
        (frame.type === "run.completed" ||
          frame.type === "run.failed" ||
          frame.type === "run.aborted")
      ) {
        boundSessionId = frame.sessionId
      }

      if (frame.type === "tool.started" && frame.id) {
        handlers.onToolStarted?.(frame.id)
      }

      if (frame.type === "tool.completed" && frame.id && frame.status !== "async_launched") {
        handlers.onToolCompleted?.(frame.id)
      }

      if (frame.type === "error" || frame.type === "run.failed") {
        failedMessage = frame.message?.trim() || "Agent run failed"
      }
    })

    socket.addEventListener("error", () => {
      finish(new Error("Unable to connect to the agent runner"))
    })

    socket.addEventListener("close", () => {
      if (handlers.signal.aborted) {
        finish(new DOMException("Aborted", "AbortError"))
        return
      }
      if (failedMessage) {
        handlers.onError(failedMessage)
        finish(null)
        return
      }
      finish(null)
    })
  })
}

function runWebsocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${protocol}//${window.location.host}${RUN_WEBSOCKET_PATH}`
}
