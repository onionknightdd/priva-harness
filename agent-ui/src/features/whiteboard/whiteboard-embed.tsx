import { useEffect, useMemo, useRef } from "react"
import { createHtmlPreviewDocument, HTML_PREVIEW_IFRAME } from "@/features/files/preview/renderers/html-preview-sandbox"
import type { JsonValue } from "./whiteboard-model"

import { EMBED_RUNTIME, EMBED_STATE_CHANNEL, isEmbedStateMessage } from "./whiteboard-embed-runtime"

export function WhiteboardEmbed({ html, state, title, disabled, onState }: { html: string; state?: JsonValue; title: string; disabled: boolean; onState(state: JsonValue): void }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const latest = useRef({ state, onState, disabled })
  latest.current = { state, onState, disabled }
  const source = useMemo(() => createHtmlPreviewDocument(`<!doctype html><html><head></head><body>${html}</body></html>`, { code: EMBED_RUNTIME, nonce: "whiteboard-state-runtime" }), [html])
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (!ref.current?.contentWindow || event.source !== ref.current.contentWindow || !isEmbedStateMessage(event.data)) return
      if (event.data.type === "ready") {
        ref.current.contentWindow.postMessage({ channel: EMBED_STATE_CHANNEL, type: "state", state: latest.current.state ?? null }, "*")
      } else if (!latest.current.disabled) latest.current.onState(event.data.state ?? null)
    }
    window.addEventListener("message", receive)
    return () => window.removeEventListener("message", receive)
  }, [])
  useEffect(() => {
    ref.current?.contentWindow?.postMessage({ channel: EMBED_STATE_CHANNEL, type: "state", state: state ?? null }, "*")
  }, [state])
  return <iframe ref={ref} title={title} srcDoc={source} onLoad={() => ref.current?.contentWindow?.postMessage({ channel: EMBED_STATE_CHANNEL, type: "state", state: latest.current.state ?? null }, "*")} {...HTML_PREVIEW_IFRAME} className="wb-embed-frame nodrag nopan nowheel" style={{ pointerEvents: disabled ? "none" : undefined }} />
}
