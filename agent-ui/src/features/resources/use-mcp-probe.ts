import { useEffect, useMemo, useState } from "react"

import { errorMessage, resourceRequest, type McpCapabilities, type McpDetail, type ResourceQuery } from "./resource-api"

type ProbeState = { capabilities: McpCapabilities | null; testing: boolean; error: string | null }
export type McpProbeState = ProbeState & { status: "disabled" | "checking" | "online" | "offline" }
const isVisible = () => document.visibilityState !== "hidden"

export function useMcpProbe(detail: McpDetail | null, query: ResourceQuery): McpProbeState {
  const scope = useMemo(() => ({
    id: detail?.id, enabled: detail?.enabled, definition: detail?.definition,
    effectiveDefinition: detail?.effectiveDefinition, harness: query.harness, cwd: query.cwd,
  }), [detail?.id, detail?.enabled, detail?.definition, detail?.effectiveDefinition, query.harness, query.cwd])
  const [result, setResult] = useState<{ scope: typeof scope; state: ProbeState } | null>(null)

  useEffect(() => {
    if (!scope.id || !scope.enabled) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let request: AbortController | undefined

    const probe = async () => {
      if (disposed || !isVisible() || request) return
      const controller = new AbortController()
      request = controller
      setResult((previous) => ({ scope, state: { capabilities: previous?.scope === scope ? previous.state.capabilities : null, error: previous?.scope === scope ? previous.state.error : null, testing: true } }))
      try {
        const capabilities = await resourceRequest<McpCapabilities>(`mcp/${scope.id}/capabilities`, { harness: scope.harness, cwd: scope.cwd }, { signal: controller.signal })
        if (!disposed && !controller.signal.aborted) setResult({ scope, state: { capabilities, testing: false, error: null } })
      } catch (reason) {
        if (!disposed && !controller.signal.aborted) setResult((previous) => ({ scope, state: { capabilities: previous?.scope === scope ? previous.state.capabilities : null, testing: false, error: errorMessage(reason) } }))
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
  }, [scope])

  const state = result?.scope === scope ? result.state : { capabilities: null, testing: Boolean(scope.enabled), error: null }
  return { ...state, status: !scope.enabled ? "disabled" : state.error ? "offline" : state.capabilities ? "online" : "checking" }
}
