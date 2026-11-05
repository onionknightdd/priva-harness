import { Box3, Color, PerspectiveCamera, Vector2, Vector3, type Plane, type Scene, type WebGLRenderer } from "three"
import { ModelNavigation } from "./model-navigation"
import type { ModelProgress, ModelSourceContext, ModelVector, ModelMetadata } from "./model-types"
import { throwIfModelAborted } from "./model-types"
import { inspectModel, modelAssetUrl, type ModelInspection } from "./model-asset"
import { getModelFormat } from "./model-format"

export type PreparedPointCloud = { url: string; revision: string }
type ConversionJob = { id: string; status: "queued" | "running" | "ready" | "failed" | "cancelled"; revision: string; error?: string; url?: string; consumerId?: string }

export async function shouldStreamPointCloud(source: ModelSourceContext, inspection: ModelInspection, signal: AbortSignal) {
  const format = getModelFormat(inspection.name)
  if (format === "las" || format === "laz" || format === "copc") return true
  if (inspection.size <= 32 * 1024 * 1024) return false
  if (format === "pcd") return true
  if (format !== "ply") return false
  const response = await fetch(modelAssetUrl(source), { signal, headers: { Range: "bytes=0-65535" } })
  if (response.status !== 206) { await response.body?.cancel(); throw new Error("Cannot inspect PLY header without byte range support") }
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength > 65536) throw new Error("Invalid PLY header range response")
  const header = new TextDecoder("ascii").decode(bytes)
  const end = header.indexOf("end_header")
  if (end < 0) throw new Error("PLY header exceeds the 64 KiB inspection limit")
  return !/^[ \t]*element[ \t]+face[ \t]+[1-9]\d*/m.test(header.slice(0, end))
}

function waitForPoll(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason ?? new DOMException("Conversion cancelled", "AbortError")) }
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve() }, 750)
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) abort()
  })
}

export async function preparePointCloud(options: { source: ModelSourceContext; signal: AbortSignal; onProgress?: (progress: ModelProgress) => void }): Promise<PreparedPointCloud> {
  const inspection = await inspectModel(options.source, options.signal)
  if (inspection.pointCloud?.copc) return { url: modelAssetUrl(options.source), revision: inspection.revision }
  options.onProgress?.({ phase: "convert", message: "Preparing spatial point cloud index" })
  const response = await fetch("/api/sandbox/pointclouds", { method: "POST", signal: options.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: options.source }) })
  if (!response.ok) throw new Error(`Cannot convert point cloud (${response.status}): ${await response.text()}`)
  let job: ConversionJob = await response.json()
  const { id, consumerId } = job
  let released = false
  const cancel = () => {
    if (!consumerId || released) return
    released = true
    void fetch(`/api/sandbox/pointclouds/${encodeURIComponent(id)}?consumer=${encodeURIComponent(consumerId)}`, { method: "DELETE" }).catch(() => undefined)
  }
  options.signal.addEventListener("abort", cancel, { once: true })
  try {
    if (options.signal.aborted) { cancel(); throwIfModelAborted(options.signal) }
    while (job.status === "queued" || job.status === "running") {
      await waitForPoll(options.signal)
      const status = await fetch(`/api/sandbox/pointclouds/${encodeURIComponent(job.id)}`, { signal: options.signal })
      if (!status.ok) throw new Error(`Cannot read conversion status (${status.status})`)
      job = await status.json()
      options.onProgress?.({ phase: "convert", message: job.status })
    }
    throwIfModelAborted(options.signal)
    if (job.status !== "ready" || !job.url) throw new Error(job.error ?? "Point cloud conversion did not complete")
    return { url: job.url, revision: job.revision }
  } finally { options.signal.removeEventListener("abort", cancel); cancel() }
}

export type PointCloudPick = {
  point: Vector3
  sourcePoint: ModelVector
  vertexIndex?: number
  sourceNodePath: number[]
  nodeId?: string
}
export type PointCloudOwner = {
  renderer: WebGLRenderer
  scene: Scene
  camera: PerspectiveCamera
  controls: ModelNavigation
  target: Vector3
  bounds: Box3
  origin: ModelVector
  revision: string
  metadata: ModelMetadata
  requestRender: () => void
  setVisible: (visible: boolean) => void
  pick: (x: number, y: number, normalized?: boolean) => PointCloudPick | null
  setClippingPlanes: (planes: Plane[]) => void
  setPointSize: (pixels: number) => void
  setAttribute: (name: string) => void
  setPointBudget: (points: number) => void
  setPointColor: (mode: "original" | "solid" | "height") => void
  getDisplayedPointCount: () => number
  dispose: () => void
}

/** Import this module lazily. A point-cloud view has exactly one renderer owner. */
export async function createPointCloudOwner(options: {
  target: HTMLDivElement
  source: PreparedPointCloud
  signal: AbortSignal
  onProgress?: (progress: ModelProgress) => void
  onError?: (error: Error) => void
}): Promise<PointCloudOwner> {
  const [{ default: Instance }, { default: PointCloud }, { default: CoordinateSystem }, { setLazPerfPath }, { GlobalCache }, { LocalPointCloudSource, ManagedCOPCSource: COPCSource }, { default: ColorMap }] = await Promise.all([
    import("@giro3d/giro3d/core/Instance.js"),
    import("@giro3d/giro3d/entities/PointCloud.js"),
    import("@giro3d/giro3d/core/geographic/CoordinateSystem.js"),
    import("@giro3d/giro3d/sources/las/config.js"),
    import("@giro3d/giro3d/core/Cache.js"),
    import("./model-pointcloud-source"),
    import("@giro3d/giro3d/core/ColorMap.js"),
  ])
  throwIfModelAborted(options.signal)
  setLazPerfPath(`${import.meta.env.BASE_URL}model-codecs`)
  if (GlobalCache.count === 0) GlobalCache.configure({ byteCapacity: 128 * 1024 * 1024, maxNumberOfEntries: 1024, ttl: 30_000 })
  const controller = new AbortController()
  const signal = AbortSignal.any([options.signal, controller.signal])
  const cacheKeys = new Set<string>()
  let rangeEtag: string | null = null
  let active = 0
  const pending: (() => void)[] = []
  const reportError = (error: unknown) => { if (!signal.aborted) options.onError?.(error instanceof Error ? error : new Error(String(error))) }
  let rawSource: InstanceType<typeof COPCSource>
  const getter = async (begin: number, end: number) => {
    throwIfModelAborted(signal)
    if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin || end - begin > 32 * 1024 * 1024) throw new Error("Point cloud node exceeds the 32 MiB request budget")
    if (active >= 6) await new Promise<void>((resolve, reject) => {
      const wake = () => { signal.removeEventListener("abort", abort); resolve() }
      const abort = () => { const index = pending.indexOf(wake); if (index >= 0) pending.splice(index, 1); reject(signal.reason) }
      pending.push(wake)
      signal.addEventListener("abort", abort, { once: true })
    })
    throwIfModelAborted(signal)
    active++
    try {
      const headers: Record<string, string> = { Range: `bytes=${begin}-${end - 1}` }
      if (rangeEtag && !rangeEtag.startsWith("W/")) headers["If-Range"] = rangeEtag
      const response = await fetch(options.source.url, { headers, signal })
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("Content-Range") ?? "")
      // COPC probes the first 64 KiB; a small valid file may end before that range.
      if (response.status !== 206 || !range || Number(range[1]) !== begin || Number(range[2]) !== Math.min(end, Number(range[3])) - 1) throw new Error("Point cloud source must support stable HTTP byte ranges")
      const etag = response.headers.get("ETag")
      if (rangeEtag && etag !== rangeEtag) throw new Error("Point cloud changed while loading; reopen the preview")
      rangeEtag = etag
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength !== Number(range[2]) - begin + 1) throw new Error("Truncated point cloud range")
      if (rawSource) cacheKeys.add(`${rawSource.id}-${begin}-${end - begin}`)
      return new Uint8Array(bytes)
    } catch (error) { reportError(error); throw error } finally { active--; pending.shift()?.() }
  }
  rawSource = new COPCSource({ url: getter, enableWorkers: true })
  const source = new LocalPointCloudSource(rawSource)
  const progress = () => options.onProgress?.({ phase: "decode", loaded: source.progress, total: 1 })
  source.addEventListener("progress", progress)
  let instance: InstanceType<typeof Instance> | undefined
  let controls: ModelNavigation | undefined
  const colorMaps: InstanceType<typeof ColorMap>[] = []
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    controller.abort()
    options.signal.removeEventListener("abort", dispose)
    source.removeEventListener("progress", progress)
    controls?.dispose()
    instance?.dispose()
    source.dispose()
    for (const colorMap of colorMaps) colorMap.dispose()
    for (const key of cacheKeys) GlobalCache.delete(key)
    cacheKeys.clear()
  }
  options.signal.addEventListener("abort", dispose, { once: true })
  try {
    await source.initialize()
    throwIfModelAborted(signal)
    const sourceMetadata = await source.getMetadata()
    throwIfModelAborted(signal)
    if (sourceMetadata.crs?.isGeographic()) throw new Error("Geographic longitude/latitude point clouds require conversion to a Cartesian CRS before measurement")
    const camera = new PerspectiveCamera(45, Math.max(options.target.clientWidth, 1) / Math.max(options.target.clientHeight, 1), 0.01, 1e7)
    camera.up.set(0, 0, 1)
    instance = new Instance({ target: options.target, crs: CoordinateSystem.unknown, camera, backgroundColor: null, renderer: { antialias: true, alpha: true } })
    instance.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
    instance.renderer.localClippingEnabled = true
    const cloud = new PointCloud({ source, cleanupDelay: 1000 })
    await instance.add(cloud)
    throwIfModelAborted(signal)
    cloud.pointBudget = 2_000_000
    cloud.subdivisionThreshold = 2
    cloud.pointSize = 2
    const bounds = sourceMetadata.volume ?? (await source.getHierarchy()).volume
    throwIfModelAborted(signal)
    const center = bounds.getCenter(new Vector3())
    const radius = Math.max(bounds.getSize(new Vector3()).length() / 2, 0.01)
    camera.near = Math.max(radius / 10000, 0.001)
    camera.far = radius * 100
    camera.position.copy(center).add(new Vector3(1, -1, 0.8).normalize().multiplyScalar(radius * 3))
    camera.updateProjectionMatrix()
    controls = new ModelNavigation(camera, instance.renderer.domElement)
    controls.target.copy(center)
    controls.update()
    instance.view.setControls(controls)
    const rgb = sourceMetadata.attributes.find((attribute) => attribute.interpretation === "color")
    if (rgb) cloud.setActiveAttribute(rgb.name)
    const solidColors = new ColorMap({ colors: [new Color(0x76a9dc), new Color(0x76a9dc)], min: bounds.min.z, max: Math.max(bounds.max.z, bounds.min.z + 0.001) })
    const heightColors = new ColorMap({ colors: Array.from({ length: 64 }, (_, index) => new Color().setHSL(0.65 - 0.65 * index / 63, 0.75, 0.55)), min: bounds.min.z, max: Math.max(bounds.max.z, bounds.min.z + 0.001) })
    colorMaps.push(solidColors, heightColors)
    const origin = source.origin.toArray() as ModelVector
    const unit = sourceMetadata.crs?.horizontal?.unit
    const metersPerUnit = unit && "metersPerUnit" in unit && typeof unit.metersPerUnit === "number" ? unit.metersPerUnit : null
    const metadata: ModelMetadata = {
      format: "copc", kind: "pointcloud", origin, bounds, pointCount: sourceMetadata.pointCount ?? 0, triangleCount: 0,
      unit: { metersPerUnit, source: metersPerUnit === null ? "unknown" : "format" },
      attributes: sourceMetadata.attributes.map((attribute) => attribute.name), crs: sourceMetadata.crs?.name,
      warnings: ["Measurements use currently displayed points, not a full-resolution survey query."],
    }
    let visible = true
    let lastMemoryCheck = 0
    instance.addEventListener("update-end", () => {
      if (performance.now() - lastMemoryCheck < 1000 || disposed) return
      lastMemoryCheck = performance.now()
      const memory = instance!.getMemoryUsage()
      if (memory.cpuMemory > 384 * 1024 * 1024 || memory.gpuMemory > 256 * 1024 * 1024) {
        cloud.subdivisionThreshold *= 1.5
        cloud.clear()
        options.onProgress?.({ phase: "decode", message: "Point cloud detail reduced to stay within the memory budget" })
      }
    })
    const owner: PointCloudOwner = {
      renderer: instance.renderer, scene: instance.scene, camera, controls, target: controls.target, bounds, origin, revision: options.source.revision, metadata,
      requestRender: () => { if (!disposed && visible) instance!.notifyChange(camera) },
      setVisible: (value) => { visible = value; cloud.visible = value; controls!.setActive(value); if (!value) cloud.clear(); else instance!.notifyChange(cloud) },
      pick: (x, y, normalized = false) => {
        if (disposed || !visible) return null
        const canvas = instance!.renderer.domElement
        const pixel = normalized ? new Vector2((x + 1) * canvas.clientWidth / 2, (1 - y) * canvas.clientHeight / 2) : new Vector2(x, y)
        const hit = cloud.pick(pixel, { radius: 4, limit: 1, gpuPicking: true })[0]
        if (!hit) return null
        return { point: hit.point.clone(), sourcePoint: hit.point.clone().add(source.origin).toArray() as ModelVector, vertexIndex: hit.index, sourceNodePath: [], nodeId: hit.object.name || undefined }
      },
      setClippingPlanes: (planes) => { cloud.clippingPlanes = planes; instance!.notifyChange(cloud) },
      setPointSize: (size) => { cloud.pointSize = Math.max(1, Math.min(size, 12)); instance!.notifyChange(cloud) },
      setAttribute: (name) => { cloud.setActiveAttribute(name); instance!.notifyChange(cloud) },
      setPointBudget: (points) => { cloud.pointBudget = Math.max(100_000, Math.min(points, 4_000_000)); instance!.notifyChange(cloud) },
      setPointColor: (mode) => {
        if (mode === "original" && rgb) cloud.setActiveAttribute(rgb.name)
        else {
          cloud.setActiveAttributes([])
          cloud.elevationColorMap = mode === "height" ? heightColors : solidColors
        }
        cloud.setColoringMode("attribute")
        instance!.notifyChange(cloud)
      },
      getDisplayedPointCount: () => cloud.displayedPointCount,
      dispose,
    }
    instance.notifyChange()
    return owner
  } catch (error) { dispose(); throw error }
}
