import { useEffect, useId, useMemo, useRef, useState } from "react"

import { createVisualizeAssetReader } from "./assets"
import { compileVisualizeJsx } from "./compile-jsx"
import { createVisualizeSrcdoc } from "./create-srcdoc"
import { isVisualizeSandboxMessage, VISUALIZE_HOST_SOURCE } from "./protocol"
import { readVisualizeThemeCss, VISUALIZE_SANDBOX_IFRAME } from "./sandbox-css"

const MIN_HEIGHT = 24
const MAX_HEIGHT = 2000
const NO_ASSETS: readonly string[] = []

export function VisualizeSandboxFrame({ jsx, streaming, title, assets = NO_ASSETS }: {
  jsx: string
  streaming: boolean
  title: string
  assets?: readonly string[]
}) {
  const frameId = useId()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const ready = useRef(false)
  const visible = useRef(true)
  const initialTheme = useRef(readVisualizeThemeCss())
  const [runtimeJs, setRuntimeJs] = useState<string | null>(null)
  const [height, setHeight] = useState(MIN_HEIGHT)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const compiled = useMemo(() => streaming ? null : compileVisualizeJsx(jsx), [jsx, streaming])
  const code = compiled?.ok ? compiled.code : null
  const latestCode = useRef(code)
  latestCode.current = code
  const assetsKey = JSON.stringify(assets)

  useEffect(() => {
    if (code === null) return
    let disposed = false
    void import("virtual:visualize-sandbox-runtime").then((module) => {
      if (!disposed) setRuntimeJs(module.default)
    }).catch((error: unknown) => { if (!disposed) setRuntimeError(error instanceof Error ? error.message : String(error)) })
    return () => { disposed = true }
  }, [code])

  // The iframe document is stable across code, theme, and stream-status updates.
  // Completed programs replace only their React root and owned Three resources.
  const srcdoc = useMemo(() => runtimeJs === null ? null : createVisualizeSrcdoc({
    runtimeJs, themeCss: initialTheme.current, frameId,
  }), [frameId, runtimeJs])

  useEffect(() => {
    const reader = createVisualizeAssetReader(JSON.parse(assetsKey) as string[])
    let disposed = false
    const post = (payload: object) => iframeRef.current?.contentWindow?.postMessage({ source: VISUALIZE_HOST_SOURCE, id: frameId, ...payload }, "*")
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || !isVisualizeSandboxMessage(event.data) || event.data.id !== frameId) return
      const message = event.data
      if (message.kind === "ready") {
        ready.current = true
        setRuntimeError(null)
        post({ kind: "theme", css: readVisualizeThemeCss() })
        post({ kind: "visibility", visible: visible.current && !document.hidden })
        if (latestCode.current !== null) post({ kind: "render", code: latestCode.current })
      } else if (message.kind === "resize") setHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(message.height))))
      else if (message.kind === "error") setRuntimeError(message.message)
      else if (message.kind === "asset") {
        void reader.read(message.path).then(
          (result) => { if (!disposed) post({ kind: "asset-result", requestId: message.requestId, ...result }) },
          (error: unknown) => { if (!disposed) post({ kind: "asset-result", requestId: message.requestId, error: error instanceof Error ? error.message : String(error) }) },
        )
      }
    }
    window.addEventListener("message", onMessage)
    return () => { disposed = true; reader.dispose(); window.removeEventListener("message", onMessage) }
  }, [assetsKey, frameId, srcdoc])

  useEffect(() => {
    if (code === null || !ready.current) return
    setRuntimeError(null)
    iframeRef.current?.contentWindow?.postMessage({ source: VISUALIZE_HOST_SOURCE, id: frameId, kind: "render", code }, "*")
  }, [code, frameId])

  useEffect(() => {
    const post = (payload: object) => iframeRef.current?.contentWindow?.postMessage({ source: VISUALIZE_HOST_SOURCE, id: frameId, ...payload }, "*")
    const observer = new MutationObserver(() => post({ kind: "theme", css: readVisualizeThemeCss() }))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] })
    const syncVisibility = () => post({ kind: "visibility", visible: visible.current && !document.hidden })
    const intersection = new IntersectionObserver((entries) => { visible.current = entries[0]?.isIntersecting ?? false; syncVisibility() })
    if (iframeRef.current) intersection.observe(iframeRef.current)
    document.addEventListener("visibilitychange", syncVisibility)
    return () => { observer.disconnect(); intersection.disconnect(); document.removeEventListener("visibilitychange", syncVisibility) }
  }, [frameId, srcdoc])

  if (srcdoc === null) {
    if (runtimeError || (compiled && !compiled.ok)) return <p className="text-sm text-destructive">{runtimeError ?? (compiled && !compiled.ok ? compiled.error : null)}</p>
    return <div className="h-32 w-full rounded-lg bg-muted/50" />
  }
  return <div className="min-w-0">
    <iframe ref={iframeRef} title={title} srcDoc={srcdoc}
      sandbox={VISUALIZE_SANDBOX_IFRAME.sandbox} referrerPolicy={VISUALIZE_SANDBOX_IFRAME.referrerPolicy} allow={VISUALIZE_SANDBOX_IFRAME.allow}
      className="block w-full border-0 bg-transparent" style={{ height }} />
    {!streaming && (runtimeError || (compiled && !compiled.ok)) ? <p className="mt-2 text-sm text-destructive">{runtimeError ?? (compiled && !compiled.ok ? compiled.error : null)}</p> : null}
  </div>
}
