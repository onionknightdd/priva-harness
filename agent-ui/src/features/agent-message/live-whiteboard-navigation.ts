import type { StreamFrame } from "./run-stream-reducer"
import { whiteboardPathFromTool, whiteboardToolKind } from "./whiteboard-tools"

export type WhiteboardNavigation = { path: string; focus: boolean; animateInitial: boolean }
type Call = { raw: string; input?: unknown; output?: string; opened?: string; restored?: boolean; failed?: boolean }

/** Navigation belongs to live protocol events, never to rendering stored messages. */
export function createLiveWhiteboardNavigation() {
  const calls = new Map<string, Call>()
  let activeSessionId: string | null | undefined
  function navigate(call: Call, cwd: string, sessionId: string | null | undefined): WhiteboardNavigation | null {
    if (call.restored || call.failed || !sessionId) return null
    const path = whiteboardPathFromTool(call.output, call.input, cwd, sessionId)
    if (!path || call.opened === path) return null
    const focus = call.opened === undefined
    call.opened = path
    return { path, focus, animateInitial: focus }
  }
  return {
    reset() { calls.clear(); activeSessionId = undefined },
    receive(frame: StreamFrame, cwd: string, sessionId: string | null | undefined): WhiteboardNavigation | null {
      const firstBoundSession = !activeSessionId && Boolean(sessionId)
      if (sessionId && activeSessionId && sessionId !== activeSessionId) calls.clear()
      if (sessionId) activeSessionId = sessionId
      if (frame.type === "session.snapshot") {
        calls.clear()
        for (const message of frame.messages ?? []) for (const block of message.blocks ?? []) {
          if (block.type === "tool_use" && whiteboardToolKind(block.name) === "write") calls.set(block.id, { raw: "", restored: true })
        }
        for (const id of frame.runningToolIds ?? []) calls.set(id, { raw: "", restored: true })
        return null
      }
      if (frame.type === "session.rebound" || frame.type === "run.started") {
        if (!frame.replay) {
          // A first binding frame may follow the first argument fragments.
          if (frame.type === "run.started" && firstBoundSession) {
            for (const call of [...calls.values()].reverse()) {
              const pending = navigate(call, cwd, sessionId)
              if (pending) return pending
            }
          } else calls.clear()
        }
        return null
      }
      if (!frame.id || !["tool.started", "tool.input_delta", "tool.updated", "tool.running", "tool.completed"].includes(frame.type ?? "")) {
        if (frame.replay) return null
        // Arguments may arrive before the session is bound. Wait for its real
        // ID rather than creating or subscribing to a draft directory.
        for (const call of [...calls.values()].reverse()) {
          if (call.opened) continue
          const pending = navigate(call, cwd, sessionId)
          if (pending) return pending
        }
        return null
      }
      if (frame.replay) {
        calls.set(frame.id, { raw: "", restored: true })
        return null
      }
      let call = calls.get(frame.id)
      if (call?.restored) return null
      if (!call) {
        if (whiteboardToolKind(frame.name ?? "") !== "write") return null
        call = { raw: "" }
        calls.set(frame.id, call)
      }
      if (frame.ok === false) { call.failed = true; return null }
      if (frame.input !== undefined) call.input = frame.input
      if (frame.type === "tool.input_delta") {
        call.raw += frame.chunk ?? ""
        try { call.input = JSON.parse(call.raw) } catch { return null }
      }
      if (frame.type === "tool.completed") call.output = frame.output
      return navigate(call, cwd, sessionId)
    },
  }
}
