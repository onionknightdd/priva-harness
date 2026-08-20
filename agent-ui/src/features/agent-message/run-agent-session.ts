const RUN_WEBSOCKET_PATH = "/api/sandbox/agent/ws/run"

export type AgentRunHarness = "claude" | "bambuddy"

export type AgentRunInit = {
  text: string
  model: string
  harness: AgentRunHarness
}

type AgentRunHandlers = {
  signal: AbortSignal
  onText: (text: string) => void
  onError: (message: string) => void
}

type ServerFrame = {
  type?: string
  event?: string
  text?: string
  message?: string
}

export function runAgentSession(
  init: AgentRunInit,
  handlers: AgentRunHandlers
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(runWebsocketUrl())
    let assembled = ""
    let settled = false
    let failedMessage: string | null = null

    const finish = (error: Error | null) => {
      if (settled) {
        return
      }
      settled = true
      handlers.signal.removeEventListener("abort", onAbort)
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close()
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
        })
      )
    })

    socket.addEventListener("message", (event) => {
      let frame: ServerFrame
      try {
        frame = JSON.parse(String(event.data)) as ServerFrame
      } catch {
        failedMessage = "Invalid agent frame"
        socket.close()
        return
      }

      if (frame.type === "error") {
        failedMessage = frame.message?.trim() || "Agent run failed"
        socket.close()
        return
      }

      if (frame.type === "assistant" && frame.event === "text_delta" && frame.text) {
        assembled += frame.text
        handlers.onText(assembled)
        return
      }

      if (frame.type === "assistant" && frame.event === "message" && frame.text) {
        assembled = frame.text
        handlers.onText(assembled)
        return
      }

      if (frame.type === "run" && frame.event === "failed") {
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
