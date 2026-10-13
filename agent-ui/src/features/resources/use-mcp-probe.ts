import { useEffect, useMemo, useRef, useState } from "react"

import { errorMessage, ResourceRequestError, resourceRequest, type McpCapabilities, type McpDetail, type McpToolState, type ResourceQuery } from "./resource-api"

type ProbeState = { capabilities: McpCapabilities | null; testing: boolean; error: string | null; errorStatus: number | null }
export type McpProbeState = ProbeState & { status: "disabled" | "checking" | "online" | "offline" | "unverified"; updateTool: (tool: McpToolState) => void; refresh: () => void }
const isVisible = () => document.visibilityState !== "hidden"

export function useMcpProbe(detail: McpDetail | null, query: ResourceQuery): McpProbeState {
  // Policy changes keep the last inventory; a different connection discards it.
  const connection = JSON.stringify([detail?.definition, detail?.effectiveDefinition], (key, value: unknown) => ["disabled", "includeTools", "excludeTools", "enabled", "exposure", "toolExposure"].includes(key) ? undefined : value)
  const scope = useMemo(() => ({
    id: detail?.id, connection, harness: query.harness, cwd: query.cwd,
  }), [detail?.id, connection, query.harness, query.cwd])
  const enabled = detail?.enabled
  const policyVersion = useRef(0)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ scope: typeof scope; state: ProbeState } | null>(null)

  useEffect(() => {
    if (!scope.id || !enabled) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let request: AbortController | undefined

    const probe = async () => {
      if (disposed || !isVisible() || request) return
      const controller = new AbortController()
      const version = policyVersion.current
      request = controller
      setResult((previous) => ({ scope, state: { capabilities: previous?.scope === scope ? previous.state.capabilities : null, error: previous?.scope === scope ? previous.state.error : null, testing: true, errorStatus: previous?.scope === scope ? previous.state.errorStatus : null } }))
      try {
        const capabilities = await resourceRequest<McpCapabilities>(`mcp/${scope.id}/capabilities`, { harness: scope.harness, cwd: scope.cwd }, { signal: controller.signal })
        if (!disposed && !controller.signal.aborted && version === policyVersion.current) setResult({ scope, state: { capabilities, testing: false, error: null, errorStatus: null } })
      } catch (reason) {
        if (!disposed && !controller.signal.aborted) setResult((previous) => ({ scope, state: { capabilities: previous?.scope === scope ? previous.state.capabilities : null, testing: false, error: errorMessage(reason), errorStatus: reason instanceof ResourceRequestError ? reason.status : null } }))
      } finally {
        if (request === controller) request = undefined
        if (!disposed && !controller.signal.aborted && isVisible()) timer = setTimeout(() => void probe(), 30_000)
      }
    }
    const visibilityChanged = () => {
      clearTimeout(timer)
      if (!isVisible()) {
        request?.abort()
        request = undefined
      } else void probe()
    }
    void probe()
    document.addEventListener("visibilitychange", visibilityChanged)
    // React Activity cleans up this effect while a cached detail is hidden.
    return () => { disposed = true; clearTimeout(timer); request?.abort(); document.removeEventListener("visibilitychange", visibilityChanged) }
  }, [scope, enabled, revision])

  const state = result?.scope === scope ? result.state : { capabilities: null, testing: Boolean(enabled), error: null, errorStatus: null }
  const updateTool = (tool: McpToolState) => {
    policyVersion.current++
    setResult((previous) => previous?.scope === scope && previous.state.capabilities ? { scope, state: { ...previous.state, testing: false,
      capabilities: { ...previous.state.capabilities, toolStates: [...previous.state.capabilities.toolStates.filter((entry) => entry.name !== tool.name), tool] } } } : previous)
  }
  return { ...state, ...(!enabled ? { testing: false, error: null, errorStatus: null } : {}), updateTool, refresh: () => setRevision((value) => value + 1), status: !enabled ? "disabled" : state.error ? state.errorStatus === 422 ? "unverified" : "offline" : state.capabilities ? "online" : "checking" }
}
