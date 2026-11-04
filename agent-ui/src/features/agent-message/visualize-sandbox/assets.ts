import { getDownloadUrl } from "@/lib/api/sandbox-files"

export const VISUALIZE_ASSET_LIMIT = 32 * 1024 * 1024
export const VISUALIZE_TOTAL_ASSET_LIMIT = 64 * 1024 * 1024
export const VISUALIZE_MAX_ASSETS = 16

export function visualizeAssetsFromInput(input: unknown): string[] {
  if (!input || typeof input !== "object") return []
  const value = (input as Record<string, unknown>).assets
  if (typeof value !== "string") return []
  const paths = [...new Set(value.split(/\r?\n/).map((path) => path.trim()).filter(Boolean))]
  if (paths.length > VISUALIZE_MAX_ASSETS || paths.some((path) => !path.startsWith("/") || path.length > 4096 || path.includes("\0") || /[\\*?]/.test(path))) return []
  return paths
}

/** Only the host's explicit tool-input allowlist grants reads to the opaque iframe. */
export function createVisualizeAssetReader(paths: readonly string[], fetcher: typeof fetch = fetch) {
  const allowed = new Set(paths)
  const controller = new AbortController()
  const reads = new Map<string, Promise<{ data: ArrayBuffer; mimeType: string }>>()
  let total = 0
  return {
    dispose: () => { controller.abort(); reads.clear() },
    read(path: string) {
      if (controller.signal.aborted) return Promise.reject(new DOMException("Preview closed", "AbortError"))
      if (!allowed.has(path)) return Promise.reject(new Error("Resource was not declared in visualize.assets"))
      const existing = reads.get(path)
      if (existing) return existing
      const request = (async () => {
        const response = await fetcher(getDownloadUrl(path), { signal: controller.signal, credentials: "same-origin", redirect: "error" })
        if (!response.ok) throw new Error(`Could not load resource (${response.status}): ${path}`)
        const expected = Number(response.headers.get("Content-Length"))
        if (expected > VISUALIZE_ASSET_LIMIT) { await response.body?.cancel(); throw new Error("Resource exceeds the 32 MiB interactive preview limit") }
        const reader = response.body?.getReader()
        if (!reader) throw new Error("Resource response has no body")
        const chunks: Uint8Array[] = []
        let size = 0
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            total += value.byteLength
            if (size > VISUALIZE_ASSET_LIMIT || total > VISUALIZE_TOTAL_ASSET_LIMIT) {
              await reader.cancel()
              throw new Error("Resources exceed the interactive preview memory limit")
            }
            chunks.push(value)
          }
        } finally { reader.releaseLock() }
        controller.signal.throwIfAborted()
        const data = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength }
        return { data: data.buffer, mimeType: response.headers.get("Content-Type") ?? "application/octet-stream" }
      })()
      reads.set(path, request)
      return request
    },
  }
}
