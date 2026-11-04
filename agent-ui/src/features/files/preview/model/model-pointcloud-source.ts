import { Vector3 } from "three"
import { PointCloudSourceBase, type GetNodeDataOptions, type PointCloudMetadata, type PointCloudNode, type PointCloudSource } from "@giro3d/giro3d/sources/PointCloudSource.js"
import type { GetMemoryUsageContext } from "@giro3d/giro3d/core/MemoryUsage.js"
import COPCSource from "@giro3d/giro3d/sources/COPCSource.js"

/** Giro 2.0.6's base initializer creates a second, unhandled rejecting promise on failure. */
export class ManagedCOPCSource extends COPCSource {
  private initialization?: Promise<this>
  private initialized = false
  override get ready() { return this.initialized }
  override initialize() {
    this.initialization ??= this.initializeOnce().then(() => {
      this.initialized = true
      this.dispatchEvent({ type: "initialized" })
      return this
    })
    return this.initialization
  }
}

/** Keeps LOD bounds and camera local while preserving the source's double-precision origins. */
export class LocalPointCloudSource extends PointCloudSourceBase {
  readonly type = "LocalPointCloudSource"
  readonly origin = new Vector3()
  private originals = new Map<string, PointCloudNode>()
  private hierarchy?: PointCloudNode
  private metadata?: PointCloudMetadata
  private initialization?: Promise<this>
  private initialized = false
  private readonly progressChanged = () => this.dispatchEvent({ type: "progress" })

  constructor(readonly source: PointCloudSource) {
    super()
    source.addEventListener("progress", this.progressChanged)
  }

  get loading() { return this.source.loading }
  get progress() { return this.source.progress }
  override get ready() { return this.initialized }

  override initialize() {
    this.initialization ??= this.initializeOnce().then(() => {
      this.initialized = true
      this.dispatchEvent({ type: "initialized" })
      return this
    })
    return this.initialization
  }

  protected async initializeOnce() {
    await this.source.initialize()
    const metadata = await this.source.getMetadata()
    const hierarchy = await this.source.getHierarchy()
    const volume = metadata.volume ?? hierarchy.volume
    volume.getCenter(this.origin)
    const translate = (node: PointCloudNode, parent?: PointCloudNode): PointCloudNode => {
      this.originals.set(node.id, node)
      const local: PointCloudNode = { ...node, sourceId: this.id, parent, volume: node.volume.clone().translate(this.origin.clone().negate()), center: node.center.clone().sub(this.origin) }
      local.children = node.children?.map((child) => child && translate(child, local))
      return local
    }
    this.hierarchy = translate(hierarchy)
    this.metadata = { ...metadata, volume: volume.clone().translate(this.origin.clone().negate()) }
    return this
  }

  async getMetadata() { await this.initialize(); return this.metadata! }
  async getHierarchy() { await this.initialize(); return this.hierarchy! }

  async getNodeData(options: GetNodeDataOptions) {
    const original = this.originals.get(options.node.id)
    if (!original) throw new Error("Unknown point cloud node")
    const data = await this.source.getNodeData({ ...options, node: original })
    return { ...data, origin: data.origin.clone().sub(this.origin) }
  }

  getMemoryUsage(context: GetMemoryUsageContext) { this.source.getMemoryUsage(context) }
  dispose() { this.source.removeEventListener("progress", this.progressChanged); this.source.dispose(); this.originals.clear() }
}
