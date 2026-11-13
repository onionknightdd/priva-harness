import type { JsonValue } from "./whiteboard-model"

export const EMBED_STATE_CHANNEL = "priva-whiteboard-state"
export const EMBED_RUNTIME = `(() => {
  let state = null;
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
  parent.postMessage({ channel: '${EMBED_STATE_CHANNEL}', type: 'ready' }, '*');
})();`

export function isEmbedStateMessage(data: unknown): data is { channel: string; type: "ready" | "change"; state?: JsonValue } {
  if (!data || typeof data !== "object" || !("channel" in data) || data.channel !== EMBED_STATE_CHANNEL || !("type" in data)) return false
  if (data.type === "ready") return true
  if (data.type !== "change" || !("state" in data)) return false
  try {
    const encoded = JSON.stringify(data.state)
    return encoded !== undefined && encoded.length <= 64_000 && JSON.stringify(JSON.parse(encoded)) === encoded
  } catch { return false }
}
