import { useCallback, useEffect, useRef, useState } from "react"

export type WhiteboardFile = { name: string; path: string }

export async function listWhiteboardFiles(cwd: string, sessionId: string, signal: AbortSignal): Promise<WhiteboardFile[]> {
  const response = await fetch("/api/sandbox/whiteboards/list", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, sessionId }), signal,
  })
  const result: unknown = await response.json()
  if (!response.ok) {
    const detail = result && typeof result === "object" && "detail" in result ? result.detail : null
    throw new Error(typeof detail === "string" ? detail : "Could not list whiteboards")
  }
  if (!result || typeof result !== "object" || !("files" in result) || !Array.isArray(result.files) || !result.files.every(file => file && typeof file === "object" && typeof file.name === "string" && typeof file.path === "string")) throw new Error("Invalid whiteboard file list")
  return result.files
}

type FileListState = { scope: string; files: WhiteboardFile[]; loading: boolean; error: string | null }
export function useWhiteboardFiles(cwd: string, sessionId: string | null | undefined, selectedPath?: string) {
  const scope = `${cwd}\0${sessionId ?? ""}`
  const currentScope = useRef(scope)
  currentScope.current = scope
  const currentPath = useRef(selectedPath)
  currentPath.current = selectedPath
  const [state, setState] = useState<FileListState>({ scope, files: [], loading: !!sessionId && !!cwd, error: null })
  const request = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const receivedContent = useRef<string | null>(null)
  const cancel = useCallback(() => { request.current?.abort(); ++generation.current }, [])
  const refresh = useCallback(async () => {
    if (currentScope.current !== scope) return
    cancel()
    const attempt = generation.current
    if (!sessionId || !cwd) {
      setState({ scope, files: [], loading: false, error: null })
      return
    }
    const controller = new AbortController()
    request.current = controller
    const isCurrent = () => !controller.signal.aborted && generation.current === attempt && currentScope.current === scope
    setState(previous => ({ scope, files: previous.scope === scope ? previous.files : [], loading: true, error: null }))
    try {
      const files = await listWhiteboardFiles(cwd, sessionId, controller.signal)
      if (isCurrent()) setState({ scope, files, loading: false, error: null })
    } catch (error) {
      if (isCurrent()) setState(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : "Could not list whiteboards" }))
    }
  }, [cwd, sessionId, scope, cancel])
  useEffect(() => {
    receivedContent.current = null
    void refresh()
    return cancel
  }, [refresh, selectedPath, cancel])
  const contentArrived = useCallback((revision: number) => {
    if (!(revision > 0) || !selectedPath || currentScope.current !== scope || currentPath.current !== selectedPath) return
    const key = `${scope}\0${selectedPath}`
    if (receivedContent.current === key) return
    receivedContent.current = key
    // Revision zero is the streaming placeholder before a file exists on disk.
    void refresh()
  }, [scope, selectedPath, refresh])
  const visible = state.scope === scope ? state : { files: [], loading: !!sessionId && !!cwd, error: null }
  return { files: visible.files, loading: visible.loading, error: visible.error, refresh, contentArrived }
}
