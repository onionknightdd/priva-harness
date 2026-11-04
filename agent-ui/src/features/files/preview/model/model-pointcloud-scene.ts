import { ModelScene } from "./model-scene"
import { createPointCloudOwner, preparePointCloud } from "./model-pointcloud"
import type { ModelInspection } from "./model-asset"
import type { ModelProgress, ModelSourceContext } from "./model-types"

export async function openPointCloudScene(target: HTMLDivElement, source: ModelSourceContext, _inspection: ModelInspection, signal: AbortSignal, onProgress: (progress: ModelProgress) => void, onViewChange: () => void, onError?: (error: Error) => void) {
  const prepared = await preparePointCloud({ source, signal, onProgress })
  const owner = await createPointCloudOwner({ target, source: prepared, signal, onProgress, onError })
  const scene = new ModelScene(target, {
    renderer: owner.renderer, scene: owner.scene, camera: owner.camera, controls: owner.controls,
    requestRender: owner.requestRender, setVisible: owner.setVisible, dispose: owner.dispose,
    pick: (x, y) => {
      const hit = owner.pick(x, y)
      return hit ? { position: hit.sourcePoint, locator: { sourceNodePath: hit.sourceNodePath, vertexIndex: hit.vertexIndex, nodeId: hit.nodeId } } : null
    },
    setClippingPlanes: owner.setClippingPlanes, setPointSize: owner.setPointSize,
    setPointColor: owner.setPointColor, setPointBudget: owner.setPointBudget,
    getDisplayedPointCount: owner.getDisplayedPointCount,
  }, onViewChange)
  scene.setPointCloud(owner.bounds, owner.origin)
  return { scene, revision: owner.revision, metadata: owner.metadata }
}
