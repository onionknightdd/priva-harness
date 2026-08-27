import { useEffect, useId, useMemo, useRef, useState } from "react"
import runtimeJs from "virtual:visualize-sandbox-runtime"

import { compileVisualizeJsx } from "./compile-jsx"
import { completeJsxTag } from "./complete-jsx"
import { createVisualizeSrcdoc } from "./create-srcdoc"
import { isVisualizeSandboxMessage } from "./protocol"
import { readVisualizeThemeCss, VISUALIZE_SANDBOX_IFRAME } from "./sandbox-css"

const MIN_HEIGHT = 24
const MAX_HEIGHT = 2000

export function VisualizeSandboxFrame({
  jsx,
  streaming,
  title,
}: {
  jsx: string
  streaming: boolean
  title: string
}) {
  const frameId = useId()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const lastGoodJs = useRef<string | null>(null)
  const [height, setHeight] = useState(MIN_HEIGHT)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [themeCss, setThemeCss] = useState(readVisualizeThemeCss)

  const source = streaming ? completeJsxTag(jsx) : jsx
  const compiled = useMemo(() => compileVisualizeJsx(source), [source])
  if (compiled.ok) {
    lastGoodJs.current = compiled.code
  }

  const userJs =
    compiled.ok
      ? compiled.code
      : streaming
        ? lastGoodJs.current
        : null

  const srcdoc = useMemo(() => {
    if (userJs === null) {
      return null
    }
    return createVisualizeSrcdoc({
      runtimeJs,
      userJs,
      themeCss,
      frameId,
    })
  }, [frameId, themeCss, userJs])

  useEffect(() => {
    setRuntimeError(null)
  }, [srcdoc])

  useEffect(() => {
    const root = document.documentElement
    const sync = () => {
      setThemeCss(readVisualizeThemeCss())
    }
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ["class", "style"] })
    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) {
        return
      }
      if (!isVisualizeSandboxMessage(event.data)) {
        return
      }
      if (event.data.id !== frameId) {
        return
      }
      if (event.data.kind === "resize") {
        setHeight(clampHeight(event.data.height))
        return
      }
      setRuntimeError(event.data.message)
    }
    window.addEventListener("message", onMessage)
    return () => {
      window.removeEventListener("message", onMessage)
    }
  }, [frameId])

  if (srcdoc === null) {
    if (streaming) {
      return <div className="h-32 w-full rounded-lg bg-muted/50" />
    }
    return (
      <p className="text-sm text-destructive">
        {compiled.ok ? null : compiled.error}
      </p>
    )
  }

  return (
    <div className="min-w-0">
      <iframe
        ref={iframeRef}
        title={title}
        srcDoc={srcdoc}
        sandbox={VISUALIZE_SANDBOX_IFRAME.sandbox}
        referrerPolicy={VISUALIZE_SANDBOX_IFRAME.referrerPolicy}
        allow={VISUALIZE_SANDBOX_IFRAME.allow}
        className="block w-full border-0 bg-transparent"
        style={{ height }}
      />
      {runtimeError && !streaming ? (
        <p className="mt-2 text-sm text-destructive">{runtimeError}</p>
      ) : null}
    </div>
  )
}

function clampHeight(height: number) {
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(height)))
}
