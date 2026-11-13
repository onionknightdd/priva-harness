import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import type { AgentThreadMessage } from "@/features/agent-message/agent-message-data"
import { whiteboardPathFromTool, whiteboardToolKind } from "@/features/agent-message/whiteboard-tools"
import { useOpenWorkspaceTab } from "./workspace-files-context"

type Whiteboards = { paths: Record<string, string>; live: Record<string, boolean>; open(scope: string, path: string, focus?: boolean, animateInitial?: boolean): void; seen(scope: string): void }
const Context = createContext<Whiteboards | null>(null)
export function WorkspaceWhiteboardProvider({ children }: { children: ReactNode }) {
  const [paths, setPaths] = useState<Record<string, string>>({})
  const [live, setLive] = useState<Record<string, boolean>>({})
  const seen = useCallback((scope: string) => setLive(current => current[scope] ? { ...current, [scope]: false } : current), [])
  const openTab = useOpenWorkspaceTab()
  const open = useCallback((scope: string, path: string, focus = true, animateInitial = false) => {
    setLive(current => current[scope] === animateInitial ? current : { ...current, [scope]: animateInitial })
    setPaths(current => current[scope] === path ? current : { ...current, [scope]: path })
    if (focus) openTab("whiteboard")
  }, [openTab])
  const value = useMemo(() => ({ paths, live, open, seen }), [paths, live, open, seen])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useWorkspaceWhiteboard() { return useContext(Context) }
export function whiteboardScope(harness: string | null, session: string | null | undefined, cwd: string) { return `${harness ?? "unselected"}:${session ?? "draft"}:${cwd}` }

export function latestWhiteboardActivity(messages: readonly AgentThreadMessage[], cwd: string, sessionId: string | null | undefined) {
  for (const message of [...messages].reverse()) {
    for (const block of [...(message.blocks ?? [])].reverse()) {
      if (block.type !== "tool_use" || !whiteboardToolKind(block.name) || block.tool?.ok === false) continue
      const input = block.tool?.input ?? block.input
      const path = whiteboardPathFromTool(block.tool?.output, input, cwd, sessionId)
      if (!path) continue
      return { id: block.id, path, running: block.tool?.status !== "completed", write: whiteboardToolKind(block.name) === "write" }
    }
  }
  return null
}
export function useWhiteboardHistory(messages: readonly AgentThreadMessage[], scope: string, cwd: string, sessionId: string | null | undefined) {
  const workspace = useWorkspaceWhiteboard()
  const open = workspace?.open
  const chosen = workspace?.paths[scope]
  const path = useMemo(() => chosen ? undefined : latestWhiteboardActivity(messages, cwd, sessionId)?.path, [chosen, messages, cwd, sessionId])
  useEffect(() => {
    if (!open || !path || chosen) return
    open(scope, path, false)
  }, [path, scope, chosen, open])
}
