import type { JsonValue } from "./whiteboard-model"

export const EMBED_STATE_CHANNEL = "priva-whiteboard-state"
export const EMBED_EXPORT_CHANNEL = "priva-whiteboard-export"
export const EMBED_RUNTIME = `(() => {
  let state = null;
  const { domToPng: capture, createContext: createCaptureContext, destroyContext: destroyCaptureContext } = window.modernScreenshot || {};
  const listeners = new Set();
  const notify = () => listeners.forEach(listener => listener(state));
  window.whiteboard = {
    get state() { return state; },
    setState(next) { state = next; parent.postMessage({ channel: '${EMBED_STATE_CHANNEL}', type: 'change', state: next }, '*'); notify(); },
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); }
  };
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.channel !== '${EMBED_STATE_CHANNEL}' || event.data?.type !== 'state') return;
    state = event.data.state; notify();
  });
  addEventListener('message', async event => {
    const request = event.data;
    if (event.source !== parent || request?.channel !== '${EMBED_EXPORT_CHANNEL}' || request?.type !== 'capture' || typeof request.requestId !== 'string' || request.requestId.length > 100) return;
    const respond = data => parent.postMessage({ channel: '${EMBED_EXPORT_CHANNEL}', requestId: request.requestId, ...data }, '*');
    try {
      if (!capture || !Number.isFinite(request.scale) || request.scale <= 0 || request.scale > 2) throw new Error('Embedded whiteboard capture is unavailable.');
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.complete && image.naturalWidth ? undefined : image.decode()));
      let missingAsset = false;
      const context = await createCaptureContext(document.documentElement, {
        width: innerWidth, height: innerHeight, scale: Math.min(request.scale, 8192 / innerWidth, 8192 / innerHeight, Math.sqrt(32000000 / (innerWidth * innerHeight))), maximumCanvasSize: 8192,
        timeout: 10000, features: { restoreScrollPosition: true },
        filter: node => !['SCRIPT', 'META'].includes(node.nodeName),
        fetchFn: async url => {
          if (!url.startsWith('blob:')) return false;
          const image = new Image(); image.src = url; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d'); if (!context) throw new Error('Unable to capture embedded image.');
          context.drawImage(image, 0, 0); return canvas.toDataURL('image/png');
        },
        fetch: { placeholderImage: () => { missingAsset = true; return ''; } }
      });
      // Default-style probing creates a child iframe that opaque origins cannot read.
      // An empty baseline copies every computed property instead of that optimization.
      context.defaultComputedStyles = new class extends Map {
        has() { return true; }
        get() { return new Map(); }
      }();
      let dataUrl;
      try { dataUrl = await capture(context); } finally { destroyCaptureContext(context); }
      if (missingAsset || !dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > 50000000) throw new Error('Embedded whiteboard content could not be exported completely.');
      respond({ type: 'snapshot', dataUrl });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      respond({ type: 'capture-error', message: 'Embedded whiteboard export failed: ' + detail.slice(0, 500) });
    }
  });
  parent.postMessage({ channel: '${EMBED_STATE_CHANNEL}', type: 'ready' }, '*');
})();`

type EmbedExportMessage = { channel: typeof EMBED_EXPORT_CHANNEL; requestId: string } & ({ type: "snapshot"; dataUrl: string } | { type: "capture-error"; message: string })
export function isEmbedExportMessage(data: unknown): data is EmbedExportMessage {
  if (!data || typeof data !== "object" || !("channel" in data) || data.channel !== EMBED_EXPORT_CHANNEL || !("requestId" in data) || typeof data.requestId !== "string" || data.requestId.length > 100 || !("type" in data)) return false
  if (data.type === "snapshot") return "dataUrl" in data && typeof data.dataUrl === "string" && data.dataUrl.startsWith("data:image/png;base64,") && data.dataUrl.length <= 50_000_000
  return data.type === "capture-error" && "message" in data && typeof data.message === "string" && data.message.length <= 1000
}

export function isEmbedStateMessage(data: unknown): data is { channel: string; type: "ready" | "change"; state?: JsonValue } {
  if (!data || typeof data !== "object" || !("channel" in data) || data.channel !== EMBED_STATE_CHANNEL || !("type" in data)) return false
  if (data.type === "ready") return true
  if (data.type !== "change" || !("state" in data)) return false
  try {
    const encoded = JSON.stringify(data.state)
    return encoded !== undefined && encoded.length <= 64_000 && JSON.stringify(JSON.parse(encoded)) === encoded
  } catch { return false }
}
