import type { ModelProgress, ModelSourceContext } from "./model-types"
import { throwIfModelAborted } from "./model-types"

export type { ModelSourceContext } from "./model-types"
export type ModelInspection = {
  name: string
  path: string
  size: number
  revision: string
  mediaType: string
  pointCloud: { copc: boolean } | null
}

function sourceParams(source: ModelSourceContext) {
  const params = new URLSearchParams({ source: source.kind, path: source.path })
  if (source.kind === "skill") {
    params.set("skillId", source.skillId)
    params.set("harness", source.harness)
    if (source.cwd) params.set("cwd", source.cwd)
  }
  return params
}

/** The server repeats containment checks against real paths, including symlinks. */
export function normalizeModelResource(uri: string) {
  if (!uri || /[\\\0]/.test(uri) || /^[a-z][a-z\d+.-]*:/i.test(uri) || uri.startsWith("/")) {
    throw new Error(`Model resource must be relative to the model directory: ${uri}`)
  }
  let decoded: string
  try { decoded = decodeURIComponent(uri) } catch { throw new Error("Invalid model resource encoding") }
  if (/[?#\\\0]/.test(decoded) || decoded.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(decoded)) {
    throw new Error(`Unsupported model resource path: ${uri}`)
  }
  const segments: string[] = []
  for (const segment of decoded.split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      if (!segments.length) throw new Error("Model resource is outside the model directory")
      segments.pop()
    } else segments.push(segment)
  }
  if (!segments.length) throw new Error("Empty model resource path")
  return segments.join("/")
}

export function modelAssetUrl(source: ModelSourceContext, resource?: string) {
  const params = sourceParams(source)
  if (resource !== undefined) params.set("resource", normalizeModelResource(resource))
  return `/api/sandbox/models/asset?${params}`
}

export async function inspectModel(source: ModelSourceContext, signal: AbortSignal): Promise<ModelInspection> {
  const response = await fetch(`/api/sandbox/models/inspect?${sourceParams(source)}`, { signal })
  if (!response.ok) throw new Error(`Cannot inspect model (${response.status})`)
  return response.json()
}

export const MAX_MODEL_BYTES = 128 * 1024 * 1024
export const MAX_MODEL_RESOURCES = 256

export async function readModelResponse(response: Response, signal: AbortSignal, onProgress?: (progress: ModelProgress) => void, maxBytes = MAX_MODEL_BYTES) {
  if (!response.ok) throw new Error(`Cannot read model resource (${response.status})`)
  const length = Number(response.headers.get("Content-Length")) || undefined
  if (length && length > maxBytes) {
    await response.body?.cancel()
    throw new Error("Model resource exceeds the preview memory budget")
  }
  const reader = response.body?.getReader()
  if (!reader) {
    const result = await response.arrayBuffer()
    if (result.byteLength > maxBytes) throw new Error("Model resource exceeds the preview memory budget")
    return result
  }
  const chunks: Uint8Array[] = []
  let loaded = 0
  try {
    while (true) {
      throwIfModelAborted(signal)
      const { done, value } = await reader.read()
      if (done) break
      loaded += value.byteLength
      if (loaded > maxBytes) throw new Error("Model resource exceeds the preview memory budget")
      chunks.push(value)
      onProgress?.({ phase: "download", loaded, total: length })
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally { reader.releaseLock() }
  const result = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
  return result.buffer
}

export async function hashModelBytes(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** Fetch once, hash every dependency, and provide synchronous URLs to Three's manager. */
export class ModelAssetResolver {
  readonly virtualBase = "https://model-resource.invalid/root/"
  private readonly resources = new Map<string, Promise<{ bytes: ArrayBuffer; blobUrl: string; hash: string }>>()
  private mainHash = ""
  private allocatedBytes = 0
  private disposed = false

  constructor(private readonly options: { url: string; resourceUrl: (uri: string) => string; signal: AbortSignal; onProgress?: (progress: ModelProgress) => void }) {}

  async readMain() {
    const data = await readModelResponse(await fetch(this.options.url, { signal: this.options.signal }), this.options.signal, this.options.onProgress)
    this.allocatedBytes = data.byteLength
    this.mainHash = await hashModelBytes(data)
    return data
  }

  async prefetch(uri: string) {
    if (uri.startsWith("data:")) return
    const key = normalizeModelResource(uri)
    if (!this.resources.has(key)) {
      if (this.resources.size >= MAX_MODEL_RESOURCES) throw new Error("Too many model dependencies")
      const pending = (async () => {
        const response = await fetch(this.options.resourceUrl(key), { signal: this.options.signal })
        const bytes = await readModelResponse(response, this.options.signal, this.options.onProgress, MAX_MODEL_BYTES - this.allocatedBytes)
        this.allocatedBytes += bytes.byteLength
        if (this.allocatedBytes > MAX_MODEL_BYTES) throw new Error("Model dependencies exceed the preview memory budget")
        const hash = await hashModelBytes(bytes)
        throwIfModelAborted(this.options.signal)
        if (this.disposed) throw new DOMException("Model disposed", "AbortError")
        const blobUrl = URL.createObjectURL(new Blob([bytes], { type: response.headers.get("Content-Type") ?? "application/octet-stream" }))
        return { bytes, blobUrl, hash }
      })()
      this.resources.set(key, pending)
    }
    return this.resources.get(key)
  }

  async readResource(uri: string) {
    const resource = await this.prefetch(uri)
    if (!resource) throw new Error("A file resource was expected")
    return resource.bytes
  }

  async createUrlModifier() {
    const resolved = new Map<string, string>()
    for (const [key, pending] of this.resources) resolved.set(new URL(key, this.virtualBase).href, (await pending).blobUrl)
    return (uri: string) => {
      // GLTFLoader creates blob URLs for embedded BIN textures; these are not external paths.
      if (uri.startsWith("data:") || uri.startsWith("blob:")) return uri
      const match = resolved.get(new URL(uri, this.virtualBase).href)
      if (!match) throw new Error(`Unresolved or external model dependency: ${uri}`)
      return match
    }
  }

  async revision() {
    const entries = await Promise.all([...this.resources].map(async ([path, resource]) => [path, (await resource).hash]))
    const manifest = JSON.stringify([this.mainHash, entries.sort((a, b) => a[0].localeCompare(b[0]))])
    return hashModelBytes(new TextEncoder().encode(manifest).buffer)
  }

  dispose() {
    this.disposed = true
    for (const resource of this.resources.values()) void resource.then(({ blobUrl }) => URL.revokeObjectURL(blobUrl), () => undefined)
    this.resources.clear()
  }
}
