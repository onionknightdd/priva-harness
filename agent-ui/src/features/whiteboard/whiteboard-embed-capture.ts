import { EMBED_EXPORT_CHANNEL, isEmbedExportMessage } from "./whiteboard-embed-runtime"

export function captureWhiteboardEmbed(frame: HTMLIFrameElement, scale: number): Promise<string> {
  const target = frame.contentWindow
  if (!target) return Promise.reject(new Error("Embedded whiteboard content is not ready to export."))
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", receive) }
    const receive = (event: MessageEvent) => {
      if (event.source !== target || !isEmbedExportMessage(event.data) || event.data.requestId !== requestId) return
      cleanup()
      if (event.data.type === "snapshot") resolve(event.data.dataUrl)
      else reject(new Error(event.data.message))
    }
    const timer = window.setTimeout(() => { cleanup(); reject(new Error("Embedded whiteboard content timed out while exporting. Try again after it loads.")) }, 15_000)
    window.addEventListener("message", receive)
    target.postMessage({ channel: EMBED_EXPORT_CHANNEL, type: "capture", requestId, scale }, "*")
  })
}
