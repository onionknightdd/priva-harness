import { Box3, BufferGeometry, Group, LoadingManager, Material, Mesh, MeshStandardMaterial, Points, PointsMaterial, SkinnedMesh, Texture, Vector3, type AnimationClip, type Object3D } from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { OBJLoader } from "three/addons/loaders/OBJLoader.js"
import { MTLLoader } from "three/addons/loaders/MTLLoader.js"
import { PLYLoader } from "three/addons/loaders/PLYLoader.js"
import { PCDLoader } from "three/addons/loaders/PCDLoader.js"
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js"
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js"
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js"
import { ModelAssetResolver, normalizeModelResource } from "./model-asset"
import { buildCadModel, parseCadInWorker } from "./model-cad"
import { getModelFormat } from "./model-format"
import { rebasePcd, rebasePly } from "./model-precision"
import { parseStl } from "./model-stl"
import { parseThreeMf } from "./model-3mf"
import { ModelConversionRequiredError, throwIfModelAborted, type LoadedModel, type LoadModelOptions, type ModelMetadata, type ModelVector } from "./model-types"

export const MAX_STATIC_POINTS_BYTES = 32 * 1024 * 1024
const MAX_MODEL_VERTICES = 8_000_000

export function disposeModelObject(root: Object3D) {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  root.traverse((object) => {
    if ("geometry" in object && object.geometry instanceof BufferGeometry) geometries.add(object.geometry)
    if ("material" in object) {
      const values = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of values) if (material instanceof Material) materials.add(material)
    }
    if (object instanceof SkinnedMesh) object.skeleton.dispose()
  })
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value)
    material.dispose()
  }
  for (const texture of textures) {
    const images = Array.isArray(texture.image) ? texture.image : [texture.image]
    for (const image of images) if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) image.close()
    texture.dispose()
  }
  for (const geometry of geometries) geometry.dispose()
  root.removeFromParent()
}

export function assignModelNodePaths(root: Object3D) {
  const visit = (node: Object3D, path: number[]) => {
    node.userData.sourceNodePath = path
    node.children.forEach((child, index) => visit(child, [...path, index]))
  }
  visit(root, [])
}

function countGeometry(root: Object3D) {
  let pointCount = 0
  let triangleCount = 0
  let vertexCount = 0
  root.traverse((object) => {
    if (!(object instanceof Mesh || object instanceof Points)) return
    const geometry = object.geometry
    const count = geometry.getAttribute("position")?.count ?? 0
    vertexCount += count
    if (object instanceof Points) pointCount += count
    else triangleCount += (geometry.index?.count ?? count) / 3
  })
  if (!vertexCount) throw new Error("Model has no displayable geometry")
  if (vertexCount > MAX_MODEL_VERTICES) throw new Error("Model exceeds the 8 million vertex preview budget")
  return { pointCount, triangleCount }
}

function defaultMesh(geometry: BufferGeometry) {
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals()
  const vertexColors = geometry.hasAttribute("color")
  return new Mesh(geometry, new MeshStandardMaterial({ color: vertexColors ? 0xffffff : 0xb5bac4, vertexColors, metalness: 0.05, roughness: 0.65 }))
}

async function loadObj(text: string, resolver: ModelAssetResolver, manager: LoadingManager) {
  const obj = new OBJLoader(manager)
  const libraries = [...text.matchAll(/^mtllib\s+(.+)$/gm)].map((match) => normalizeModelResource(match[1].trim()))
  if (!libraries.length) return obj.parse(text)
  const creators: MTLLoader.MaterialCreator[] = []
  for (const library of libraries) {
    const directory = library.includes("/") ? library.slice(0, library.lastIndexOf("/") + 1) : ""
    const materialText = new TextDecoder().decode(await resolver.readResource(library))
    const creator = new MTLLoader(manager).parse(materialText, resolver.virtualBase + directory)
    for (const info of Object.values(creator.materialsInfo)) for (const [property, value] of Object.entries(info)) {
      if (typeof value === "string" && (/^map_/.test(property) || ["bump", "norm", "disp"].includes(property))) {
        const uri = creator.getTextureParams(value, {}).url
        await resolver.prefetch(normalizeModelResource(directory + uri))
      }
    }
    creators.push(creator)
  }
  manager.setURLModifier(await resolver.createUrlModifier())
  const merged = new MTLLoader(manager).parse("", resolver.virtualBase)
  for (const creator of creators) { creator.preload(); Object.assign(merged.materials, creator.materials) }
  obj.setMaterials(merged)
  return obj.parse(text)
}

export async function loadModel(options: LoadModelOptions): Promise<LoadedModel> {
  const format = getModelFormat(options.name)
  if (!format) throw new Error("Unsupported model format")
  if (["las", "laz", "copc"].includes(format)) throw new ModelConversionRequiredError("LAS and LAZ use the streamed point cloud viewer")
  throwIfModelAborted(options.signal)
  const resolver = new ModelAssetResolver(options)
  const manager = new LoadingManager()
  const codecManager = new LoadingManager()
  const errors: string[] = []
  let loading = false
  let finishResources: (() => void) | undefined
  const resourcesReady = new Promise<void>((resolve) => { finishResources = resolve })
  manager.onStart = () => { loading = true }
  manager.onLoad = () => { finishResources?.() }
  manager.onError = (uri) => errors.push(uri)
  const codecBase = `${import.meta.env?.BASE_URL ?? "/"}model-codecs/`
  const draco = new DRACOLoader(codecManager).setDecoderPath(codecBase + "draco/").setWorkerLimit(2)
  let ktx2: KTX2Loader | undefined
  let threeMf: ReturnType<typeof parseThreeMf> | undefined
  let root = new Group()
  const unusedScenes: Group[] = []
  let animations: AnimationClip[] = []
  let origin: ModelVector = [0, 0, 0]
  let kind: ModelMetadata["kind"] = "mesh"
  let disposed = false
  const cleanup = () => {
    if (disposed) return
    disposed = true
    options.signal.removeEventListener("abort", abort)
    manager.abort()
    codecManager.abort()
    draco.dispose()
    ktx2?.dispose()
    threeMf?.dispose()
    disposeModelObject(root)
    for (const scene of unusedScenes) disposeModelObject(scene)
    resolver.dispose()
  }
  let rejectAbort: (error: unknown) => void = () => undefined
  const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject })
  const abort = () => { cleanup(); rejectAbort(options.signal.reason ?? new DOMException("Model loading cancelled", "AbortError")) }
  options.signal.addEventListener("abort", abort, { once: true })
  const work = async (): Promise<LoadedModel> => {
    const bytes = await resolver.readMain()
    throwIfModelAborted(options.signal)
    options.onProgress?.({ phase: "parse" })
    if (format === "glb" || format === "gltf") {
      const loader = new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder)
      if (options.renderer) {
        ktx2 = new KTX2Loader(codecManager).setTranscoderPath(codecBase + "basis/").setWorkerLimit(2).detectSupport(options.renderer)
        loader.setKTX2Loader(ktx2)
      }
      loader.register((parser) => ({
        name: "MODEL_SCOPED_RESOURCES",
        beforeRoot: async () => {
          const definitions = [...(parser.json.buffers ?? []), ...(parser.json.images ?? [])] as { uri?: string }[]
          for (const definition of definitions) if (definition.uri) await resolver.prefetch(definition.uri)
          manager.setURLModifier(await resolver.createUrlModifier())
        },
      }))
      const result = await loader.parseAsync(bytes, resolver.virtualBase)
      root.add(result.scene)
      animations = result.animations
      // Other glTF scenes can own resources even when they are not displayed.
      for (const scene of result.scenes) if (scene !== result.scene) unusedScenes.push(scene)
    } else if (format === "3mf") {
      threeMf = parseThreeMf(bytes, manager)
      root.add(threeMf.root)
    } else if (format === "obj") {
      root.add(await loadObj(new TextDecoder().decode(bytes), resolver, manager))
    } else if (format === "stl") {
      const geometry = parseStl(bytes)
      // Many STL exporters write zero facet normals. Reconstruct them from winding.
      geometry.computeVertexNormals()
      root.add(defaultMesh(geometry))
    } else if (format === "ply") {
      if (bytes.byteLength > MAX_STATIC_POINTS_BYTES) {
        const header = new TextDecoder().decode(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 65536))).split("end_header", 1)[0]
        if (!/^[ \t]*element[ \t]+face[ \t]+[1-9]\d*/m.test(header)) throw new ModelConversionRequiredError("Large PLY files use the streamed point cloud conversion path")
      }
      const rebased = rebasePly(bytes)
      origin = rebased.origin
      const geometry = new PLYLoader(manager).parse(rebased.data)
      if (rebased.hasFaces) root.add(defaultMesh(geometry))
      else {
        kind = "pointcloud"
        root.add(new Points(geometry, new PointsMaterial({ size: 0.02, vertexColors: Boolean(geometry.getAttribute("color")), color: geometry.getAttribute("color") ? 0xffffff : 0x76a9dc })))
      }
    } else if (format === "pcd") {
      if (bytes.byteLength > MAX_STATIC_POINTS_BYTES) throw new ModelConversionRequiredError("Large PCD files use the streamed point cloud conversion path")
      const rebased = rebasePcd(bytes)
      origin = rebased.origin
      kind = "pointcloud"
      root.add(new PCDLoader(manager).parse(rebased.data))
    } else if (format === "step" || format === "iges") {
      const cad = buildCadModel(await parseCadInWorker(bytes, format, options.signal))
      root = cad.root
      origin = cad.origin
      kind = "cad"
    }
    if (loading) await resourcesReady
    if (errors.length) throw new Error("One or more model textures or buffers could not be loaded")
    throwIfModelAborted(options.signal)
    root.updateMatrixWorld(true)
    const initialBounds = new Box3().setFromObject(root)
    if (initialBounds.isEmpty()) throw new Error("Model is empty")
    if (![...initialBounds.min.toArray(), ...initialBounds.max.toArray()].every(Number.isFinite)) throw new Error("Model contains invalid coordinates")
    // For point clouds and CAD the high precision rebase already happened before Float32.
    // Mesh source geometry is left intact; only the wrapper shifts its display origin.
    if (origin.every((value) => value === 0)) {
      origin = initialBounds.getCenter(new Vector3()).toArray() as ModelVector
      root.position.sub(new Vector3(...origin))
      root.updateMatrixWorld(true)
    }
    assignModelNodePaths(root)
    const counts = countGeometry(root)
    const metadata: ModelMetadata = {
      format, kind, origin, bounds: new Box3().setFromObject(root), ...counts,
      unit: threeMf?.unit ?? (format === "glb" || format === "gltf" || kind === "cad" ? { metersPerUnit: 1, source: "format" } : { metersPerUnit: null, source: "unknown" }),
      warnings: kind === "cad" ? ["CAD measurements use tessellated surfaces."] : kind === "pointcloud" ? ["Measurements select displayed points; source units must be confirmed."] : [],
    }
    const revision = await resolver.revision()
    return { root, animations, metadata, revision, dispose: cleanup }
  }
  const pending = work()
  // A synchronous parser cannot be interrupted; dispose its result if cancellation wins.
  void pending.then((result) => { if (options.signal.aborted) disposeModelObject(result.root) }, () => { if (disposed) disposeModelObject(root) })
  try { return await Promise.race([pending, cancelled]) } catch (error) { cleanup(); throw error }
}
