import { applyBoardChange, createdElementCues, type AnimationCue, type Board, type BoardClaim, type BoardContext, type BoardOperation } from "./whiteboard-model"

export type WhiteboardConnectionState = "connecting" | "connected" | "disconnected"
type Socket = Pick<WebSocket, "send" | "close" | "readyState" | "addEventListener" | "removeEventListener">
export type ConnectionCallbacks = {
  board(board: Board, cues: Record<string, AnimationCue>, resetAnimations?: boolean): void
  status(state: WhiteboardConnectionState): void
  claims(claims: BoardClaim[]): void
  pending(count: number): void
  error(message: string | null): void
}

export function whiteboardSocketUrl(path: string, href = window.location.href) {
  const url = new URL("/api/sandbox/whiteboards/stream", href)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.searchParams.set("path", path)
  return url.href
}

export function connectWhiteboard(path: string, callbacks: ConnectionCallbacks, createSocket: (url: string) => Socket = url => new WebSocket(url), href?: string) {
  let socket: Socket | null = null, board: Board | null = null
  let disposed = false, ready = false, generation = 0, nextRequest = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let snapshotTimer: ReturnType<typeof setTimeout> | undefined
  let context: BoardContext = { selection: [] }
  const pending = new Map<string, BoardOperation[]>()

  function publish(cues: Record<string, AnimationCue> = {}, resetAnimations = false) {
    if (!board) return
    let projected = board
    for (const ops of pending.values()) {
      // Deletion cascades are authoritative server operations; wait for their delta.
      const applicable = ops.filter(op => op.op === "update" && Object.hasOwn(projected.elements, op.id))
      projected = { ...applyBoardChange(projected, projected.revision + 1, applicable, projected.title), revision: board.revision }
    }
    callbacks.board(projected, cues, resetAnimations)
  }

  function clearPending(message?: string) {
    if (pending.size && message) callbacks.error(message)
    pending.clear(); callbacks.pending(0)
  }
  function open() {
    const currentGeneration = ++generation
    clearTimeout(retryTimer)
    clearTimeout(snapshotTimer)
    socket?.close()
    ready = false
    callbacks.status("connecting")
    const current = createSocket(whiteboardSocketUrl(path, href))
    socket = current
    const currentAttempt = () => !disposed && generation === currentGeneration
    snapshotTimer = setTimeout(() => {
      if (!currentAttempt()) return
      callbacks.error("Whiteboard connection timed out. Retrying…")
      current.close()
    }, 15_000)
    current.addEventListener("message", event => {
      if (!currentAttempt()) return
      try {
        const frame = JSON.parse(String((event as MessageEvent).data))
        if (!frame || typeof frame !== "object") throw new Error("Invalid whiteboard response")
        if (frame.type === "snapshot") {
          const value = frame.board
          if (value?.v !== 1 || !Number.isInteger(value.revision) || typeof value.title !== "string" || !Array.isArray(value.order) || !value.elements || typeof value.elements !== "object") throw new Error("Invalid whiteboard snapshot")
          clearTimeout(snapshotTimer)
          board = value as Board
          ready = true
          publish({}, true)
          callbacks.status("connected")
          current.send(JSON.stringify({ type: "context", ...context }))
        } else if (frame.type === "change") {
          if (!board || !Array.isArray(frame.ops) || typeof frame.title !== "string") throw new Error("Invalid whiteboard change")
          const cues = createdElementCues(board, frame.ops, frame.revision, frame.source)
          board = applyBoardChange(board, frame.revision, frame.ops, frame.title, frame.order)
          publish(cues)
        } else if (frame.type === "ack") {
          pending.delete(frame.requestId); callbacks.pending(pending.size); publish()
        } else if (frame.type === "error") {
          clearTimeout(snapshotTimer)
          pending.delete(frame.requestId); callbacks.pending(pending.size)
          callbacks.error(typeof frame.message === "string" ? frame.message : "Whiteboard request failed")
          publish()
          if (!frame.requestId) { ready = false; callbacks.status("disconnected") }
        } else if (frame.type === "presence") {
          callbacks.claims(Array.isArray(frame.claims) ? frame.claims : [])
        }
      } catch (error) {
        callbacks.error(error instanceof Error ? error.message : "Invalid whiteboard response")
        current.close()
      }
    })
    current.addEventListener("close", () => {
      if (!currentAttempt()) return
      ready = false
      clearTimeout(snapshotTimer)
      callbacks.status("disconnected")
      callbacks.claims([])
      clearPending("Connection interrupted. Changes may not have been saved; reconnect to check.")
      retryTimer = setTimeout(open, 1500)
    })
    current.addEventListener("error", () => {
      if (!currentAttempt()) return
      callbacks.status("disconnected")
      current.close()
    })
  }
  open()
  return {
    write(ops: BoardOperation[]) {
      if (!ready || socket?.readyState !== 1) {
        callbacks.error("Whiteboard is disconnected. Reconnect before editing.")
        publish()
        return false
      }
      const requestId = `edit-${++nextRequest}`
      callbacks.error(null)
      pending.set(requestId, ops); callbacks.pending(pending.size); publish()
      socket.send(JSON.stringify({ type: "write", requestId, ops }))
      return true
    },
    context(next: BoardContext) {
      context = next
      if (ready && socket?.readyState === 1) socket.send(JSON.stringify({ type: "context", ...context }))
    },
    retry() { clearPending(); callbacks.error(null); open() },
    dispose() {
      disposed = true; ++generation
      clearTimeout(retryTimer)
      clearTimeout(snapshotTimer)
      ready = false
      socket?.close(); clearPending()
    },
  }
}
