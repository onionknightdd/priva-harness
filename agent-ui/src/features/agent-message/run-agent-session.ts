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

export type AgentRunAttach = {
  harness: AgentRunHarness
  sinceSeq: number
  sessionId?: string
  runId?: string
}

export type AgentRunAbort = {
  harness: AgentRunHarness
  sessionId?: string
  runId?: string
}

export type AgentRunConnection = {
  disconnect: () => void
  abort: () => void
  finished: Promise<void>
}

type AgentRunHandlers = {
  onFrame: (frame: StreamFrame) => void
  onError: (message: string) => void
  onSession?: (sessionId: string) => void
  onReplayGap?: () => void
  onToolStarted?: (id: string) => void
  onToolCompleted?: (id: string) => void
}

export function runAgentSession(
  init: AgentRunInit,
  handlers: AgentRunHandlers
): AgentRunConnection {
  return openRunSocket(
    {
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
    },
    handlers,
    { harness: init.harness, sessionId: init.sessionId }
  )
}

export function attachAgentSession(
  attach: AgentRunAttach,
  handlers: AgentRunHandlers
): AgentRunConnection {
  return openRunSocket(
    {
      type: "attach",
      harness: attach.harness,
      sinceSeq: attach.sinceSeq,
      ...(attach.sessionId === undefined ? {} : { sessionId: attach.sessionId }),
      ...(attach.runId === undefined ? {} : { runId: attach.runId }),
    },
    handlers,
    { harness: attach.harness, sessionId: attach.sessionId, runId: attach.runId }
  )
}

export function abortAgentSession(target: AgentRunAbort): AgentRunConnection {
  return openRunSocket(
    {
      type: "abort",
      harness: target.harness,
      ...(target.sessionId === undefined ? {} : { sessionId: target.sessionId }),
      ...(target.runId === undefined ? {} : { runId: target.runId }),
    },
    {
      onFrame: () => undefined,
      onError: () => undefined,
    },
    target
  )
}

function openRunSocket(
  firstFrame: Record<string, unknown>,
  handlers: AgentRunHandlers,
  abortTarget: AgentRunAbort
): AgentRunConnection {
  const socket = new WebSocket(runWebsocketUrl())
  const seen = new Set<string>()
  let settled = false
  let failedMessage: string | null = null
  let boundSessionId: string | null = abortTarget.sessionId ?? null
  let boundRunId: string | null = abortTarget.runId ?? null
  let resolveFinished: (error: Error | null) => void = () => undefined

  const finished = new Promise<void>((resolve, reject) => {
    resolveFinished = (error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    }
  })

  const finish = (error: Error | null) => {
    if (settled) {
      return
    }
    settled = true
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close()
    }
    if (boundSessionId) {
      handlers.onSession?.(boundSessionId)
    }
    resolveFinished(error)
  }

  const disconnect = () => {
    finish(null)
  }

  const abort = () => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "abort",
          harness: abortTarget.harness,
          ...(boundSessionId ? { sessionId: boundSessionId } : {}),
          ...(boundRunId ? { runId: boundRunId } : abortTarget.runId ? { runId: abortTarget.runId } : {}),
        })
      )
      return
    }
    finish(null)
  }

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify(firstFrame))
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

    if (typeof frame.runId === "string" && frame.runId !== "") {
      boundRunId = frame.runId
    }

    if (typeof frame.seq === "number" && typeof frame.runId === "string") {
      const key = `${frame.runId}:${frame.seq}`
      if (seen.has(key)) {
        return
      }
      seen.add(key)
    }

    if (frame.type === "replay.gap") {
      handlers.onReplayGap?.()
      return
    }

    handlers.onFrame(frame)

    if (typeof frame.sessionId === "string" && frame.sessionId !== "") {
      boundSessionId = frame.sessionId
      handlers.onSession?.(frame.sessionId)
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
    if (failedMessage) {
      handlers.onError(failedMessage)
      finish(null)
      return
    }
    finish(null)
  })

  return {
    disconnect,
    abort,
    finished: finished.catch((error: unknown) => {
      if (error instanceof Error) {
        throw error
      }
      throw new Error("Agent run failed")
    }),
  }
}

function runWebsocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${protocol}//${window.location.host}${RUN_WEBSOCKET_PATH}`
}
