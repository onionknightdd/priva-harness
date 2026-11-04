import { Box3, BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Vector3 } from "three"
import type { CadNode, CadResult } from "./model-cad-types"
import type { ModelVector } from "./model-types"
import { throwIfModelAborted } from "./model-types"

export function buildCadModel(result: CadResult): { root: Group; origin: ModelVector } {
  if (!result.success || !result.meshes.length) throw new Error("CAD model contains no displayable surfaces")
  const bounds = new Box3()
  const point = new Vector3()
  for (const mesh of result.meshes) {
    const positions = mesh.attributes.position.array
    for (let i = 0; i < positions.length; i += 3) {
      point.set(positions[i], positions[i + 1], positions[i + 2])
      if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error("Invalid CAD vertex")
      bounds.expandByPoint(point)
    }
  }
  const origin = bounds.getCenter(new Vector3()).toArray() as ModelVector
  const objects = result.meshes.map((source) => {
    const geometry = new BufferGeometry()
    // OCCT returns JS doubles. Subtract the origin before allocating Float32 GPU buffers.
    const positions = source.attributes.position.array.map((value, index) => value - origin[index % 3])
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3))
    geometry.setIndex(source.index.array)
    if (source.attributes.normal) geometry.setAttribute("normal", new Float32BufferAttribute(source.attributes.normal.array, 3))
    else geometry.computeVertexNormals()
    const base = new MeshStandardMaterial({ color: source.color ? new Color().fromArray(source.color) : 0xb5bac4, metalness: 0.05, roughness: 0.65 })
    const materials = [base]
    for (const face of source.brep_faces ?? []) {
      let materialIndex = 0
      if (face.color) {
        materialIndex = materials.length
        materials.push(new MeshStandardMaterial({ color: new Color().fromArray(face.color), metalness: 0.05, roughness: 0.65 }))
      }
      geometry.addGroup(face.first * 3, (face.last - face.first + 1) * 3, materialIndex)
    }
    if (!geometry.groups.length) geometry.addGroup(0, source.index.array.length, 0)
    const mesh = new Mesh(geometry, materials)
    mesh.name = source.name
    mesh.userData.cadFaces = source.brep_faces
    return mesh
  })
  const build = (node: CadNode): Group => {
    const group = new Group()
    group.name = node.name
    for (const index of node.meshes) {
      if (!objects[index]) throw new Error("Invalid CAD assembly mesh index")
      group.add(objects[index].clone())
    }
    for (const child of node.children) group.add(build(child))
    return group
  }
  return { root: build(result.root), origin }
}

export async function parseCadInWorker(data: ArrayBuffer, format: "step" | "iges", signal: AbortSignal): Promise<CadResult> {
  throwIfModelAborted(signal)
  const worker = new Worker(new URL("./model-cad.worker.ts", import.meta.url), { type: "module" })
  return new Promise((resolve, reject) => {
    const cleanup = () => { worker.terminate(); signal.removeEventListener("abort", abort) }
    const abort = () => { cleanup(); reject(signal.reason ?? new DOMException("CAD import cancelled", "AbortError")) }
    signal.addEventListener("abort", abort, { once: true })
    worker.onerror = (event) => { cleanup(); reject(new Error(event.message || "CAD worker failed")) }
    worker.onmessage = (event: MessageEvent<{ result?: CadResult; error?: string }>) => {
      cleanup()
      if (event.data.result) resolve(event.data.result)
      else reject(new Error(event.data.error ?? "CAD import failed"))
    }
    const wasmUrl = new URL(`${import.meta.env.BASE_URL}model-codecs/occt-import-js.wasm`, location.href).href
    worker.postMessage({ data, format, wasmUrl }, [data])
  })
}
