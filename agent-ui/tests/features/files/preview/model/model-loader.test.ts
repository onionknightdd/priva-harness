import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { test } from "node:test"
import { Mesh, Points } from "three"
import { ModelAssetResolver, modelAssetUrl, normalizeModelResource } from "../../../../../src/features/files/preview/model/model-asset"
import { getModelFormat } from "../../../../../src/features/files/preview/model/model-format"
import { buildCadModel } from "../../../../../src/features/files/preview/model/model-cad"
import { loadModel, disposeModelObject } from "../../../../../src/features/files/preview/model/model-loader"
import { rebasePcd } from "../../../../../src/features/files/preview/model/model-precision"
import { ModelConversionRequiredError } from "../../../../../src/features/files/preview/model/model-types"
import type { OcctModule } from "../../../../../src/features/files/preview/model/model-cad-types"
import { doubleBinaryPcd, doubleBinaryPly, pointPcd, pointPly, triangleGlb, triangleGltf, triangleObj, trianglePositions, triangleStl } from "./model-fixtures"

globalThis.ProgressEvent ??= class extends Event { constructor(type: string, init: ProgressEventInit = {}) { super(type); Object.assign(this, init) } } as typeof ProgressEvent

test("model formats recognize all supported families and COPC suffix", () => {
  for (const [name, format] of [["x.GLB", "glb"], ["x.gltf", "gltf"], ["x.obj", "obj"], ["x.stl", "stl"], ["x.ply", "ply"], ["x.pcd", "pcd"], ["x.STP", "step"], ["x.step", "step"], ["x.IGS", "iges"], ["x.iges", "iges"], ["x.las", "las"], ["x.laz", "laz"], ["x.copc.laz", "copc"]]) assert.equal(getModelFormat(name), format)
  assert.equal(getModelFormat("document.docx"), null)
})

test("resource resolution rejects external and escaping paths", () => {
  assert.equal(normalizeModelResource("textures/a%20b.png"), "textures/a b.png")
  assert.equal(normalizeModelResource("textures/../base.png"), "base.png")
  for (const uri of ["../secret", "%2e%2e/secret", "/etc/passwd", "https://example.org/x", "//example.org/x", "data:text/plain,x", "blob:123", "a\\b", "a?token=x"]) assert.throws(() => normalizeModelResource(uri))
  const url = new URL(modelAssetUrl({ kind: "skill", skillId: "s", harness: "pi", cwd: "/workspace", path: "model/a.gltf" }, "buffers/x.bin"), "http://localhost")
  assert.equal(url.searchParams.get("source"), "skill")
  assert.equal(url.searchParams.get("resource"), "buffers/x.bin")
})

test("real native loaders parse GLB, external glTF, OBJ/MTL, STL and precision-preserving PLY/PCD", async () => {
  const originalFetch = globalThis.fetch
  const files = new Map<string, BodyInit>([
    ["/triangle.glb", triangleGlb()], ["/triangle.gltf", JSON.stringify(triangleGltf("triangle.bin"))],
    ["/triangle.bin", trianglePositions.buffer], ["/triangle.obj", "mtllib triangle.mtl\nusemtl gray\n" + triangleObj],
    ["/triangle.mtl", "newmtl gray\nKd 0.4 0.5 0.6\n"], ["/triangle.stl", triangleStl.replace("normal 0 0 1", "normal 0 0 0")], ["/cloud.ply", pointPly], ["/binary.ply", doubleBinaryPly()], ["/cloud.pcd", pointPcd], ["/binary.pcd", doubleBinaryPcd()],
  ])
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.startsWith("blob:")) return originalFetch(input, init)
    assert.ok(files.has(url), `unexpected resource ${url}`)
    return new Response(files.get(url))
  }
  try {
    for (const name of ["triangle.glb", "triangle.gltf", "triangle.obj", "triangle.stl", "cloud.ply", "binary.ply", "cloud.pcd", "binary.pcd"]) {
      const model = await loadModel({ name, url: "/" + name, resourceUrl: (uri) => "/" + uri, signal: new AbortController().signal })
      assert.match(model.revision, /^[a-f0-9]{64}$/)
      assert.equal(model.root.userData.sourceNodePath.length, 0)
      assert.deepEqual(model.root.children[0].userData.sourceNodePath, [0])
      if (name.includes("cloud") || name.startsWith("binary")) {
        const points = model.root.children[0] as Points
        assert.equal(model.metadata.pointCount, 2)
        assert.deepEqual(model.metadata.origin, [1000000, 2000000, 3])
        const x = points.geometry.getAttribute("position").getX(1)
        assert.ok(Math.abs(x - 0.001) < 1e-8, `${name} retained millimetre detail at million-unit coordinates: ${x}`)
      } else {
        assert.equal(model.metadata.triangleCount, 1)
        if (name === "triangle.stl") assert.equal((model.root.children[0] as Mesh).geometry.getAttribute("normal").getZ(0), 1)
      }
      model.dispose()
      model.dispose()
    }
  } finally { globalThis.fetch = originalFetch }
})

test("revision changes when only a model dependency changes", async () => {
  const originalFetch = globalThis.fetch
  let dependency = "one"
  globalThis.fetch = async (input) => new Response(String(input) === "/main" ? "model" : dependency)
  const getRevision = async () => {
    const resolver = new ModelAssetResolver({ url: "/main", resourceUrl: () => "/dependency", signal: new AbortController().signal })
    await resolver.readMain()
    await resolver.prefetch("texture.png")
    const revision = await resolver.revision()
    resolver.dispose()
    return revision
  }
  try { const first = await getRevision(); dependency = "two"; assert.notEqual(await getRevision(), first) } finally { globalThis.fetch = originalFetch }
})

test("compressed PCD explicitly chooses the streamed precision path", () => {
  assert.throws(() => rebasePcd(new TextEncoder().encode(pointPcd.replace("DATA ascii", "DATA binary_compressed")).buffer), ModelConversionRequiredError)
  assert.throws(() => rebasePcd(new TextEncoder().encode(pointPcd.replace("COUNT 1 1 1", "COUNT 2 1 1")).buffer), ModelConversionRequiredError)
})

test("aborting a model load cancels the in-flight resource read", async () => {
  const originalFetch = globalThis.fetch
  const controller = new AbortController()
  let aborted = false
  globalThis.fetch = (_input, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => { aborted = true; reject(new DOMException("Aborted", "AbortError")) }, { once: true })
  })
  try {
    const pending = loadModel({ name: "mesh.stl", url: "/slow", resourceUrl: (uri) => uri, signal: controller.signal })
    controller.abort()
    await assert.rejects(pending, { name: "AbortError" })
    assert.equal(aborted, true)
  } finally { globalThis.fetch = originalFetch }
})

test("real OCCT parses STEP and IGES and emits metric geometry", async () => {
  const require = createRequire(import.meta.url)
  const initialize = require("occt-import-js") as () => Promise<OcctModule>
  const occt = await initialize()
  for (const [format, fixture] of [["step", "simple-basic-cube/cube.stp"], ["iges", "cube-10x10mm/Cube 10x10.igs"]]) {
    const bytes = await readFile(new URL(`../../../../../node_modules/occt-import-js/test/testfiles/${fixture}`, import.meta.url))
    const options = { linearUnit: "meter", linearDeflectionType: "bounding_box_ratio", linearDeflection: 0.001, angularDeflection: 0.5 }
    const result = format === "step" ? occt.ReadStepFile(bytes, options) : occt.ReadIgesFile(bytes, options)
    const model = buildCadModel(result)
    let triangles = 0
    model.root.traverse((object) => { if (object instanceof Mesh) triangles += object.geometry.index!.count / 3 })
    assert.ok(triangles >= 12)
    if (format === "iges") assert.ok(model.origin.every((value) => Math.abs(value) < 1))
    disposeModelObject(model.root)
  }
})
