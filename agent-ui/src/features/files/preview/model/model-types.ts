import type { AnimationClip, Box3, Group, WebGLRenderer } from "three"

export type ModelFormat = "glb" | "gltf" | "obj" | "stl" | "ply" | "pcd" | "step" | "iges" | "las" | "laz" | "copc"
export type ModelVector = [number, number, number]
export type ModelSourceContext =
  | { kind: "file"; path: string }
  | { kind: "skill"; skillId: string; harness: "claude" | "pi"; cwd?: string; path: string }

export type ModelUnit = { metersPerUnit: number | null; source: "format" | "unknown" }
export type ModelMetadata = {
  format: ModelFormat
  kind: "mesh" | "pointcloud" | "cad"
  unit: ModelUnit
  /** Source coordinates = displayed coordinates + origin. No display rescaling is applied. */
  origin: ModelVector
  bounds: Box3
  pointCount: number
  triangleCount: number
  warnings: string[]
  attributes?: string[]
  crs?: string
}

export type ModelProgress = { phase: "download" | "parse" | "convert" | "decode"; loaded?: number; total?: number; message?: string }
export type LoadModelOptions = {
  name: string
  url: string
  resourceUrl: (relativeUri: string) => string
  signal: AbortSignal
  onProgress?: (progress: ModelProgress) => void
  renderer?: WebGLRenderer
}
export type LoadedModel = {
  root: Group
  revision: string
  metadata: ModelMetadata
  animations: AnimationClip[]
  dispose: () => void
}

export class ModelConversionRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ModelConversionRequiredError"
  }
}

export function throwIfModelAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new DOMException("Model loading cancelled", "AbortError")
}
