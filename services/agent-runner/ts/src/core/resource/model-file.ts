export const MODEL_EXTENSIONS = new Set(['glb', 'gltf', 'obj', 'stl', '3mf', 'ply', 'pcd', 'las', 'laz', 'step', 'stp', 'iges', 'igs'])
export const POINT_CLOUD_EXTENSIONS = new Set(['ply', 'pcd', 'las', 'laz'])

export function modelExtension(name: string): string {
  return name.slice(name.lastIndexOf('.') + 1).toLowerCase()
}

export function isModelFile(name: string): boolean {
  return MODEL_EXTENSIONS.has(modelExtension(name))
}
