import { zipSync, strToU8 } from "fflate"
import { Mesh, type Texture } from "three"
import { loadModel } from "../../../../../src/features/files/preview/model/model-loader"
import { ModelScene } from "../../../../../src/features/files/preview/model/model-scene"
import { runModelNavigationChecks } from "./model-navigation-browser"

function texturedPackage(png: Uint8Array) {
  return zipSync({
    "_rels/.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="3D/main.model"/></Relationships>'),
    "3D/_rels/main.model.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="texture" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dtexture" Target="/3D/Textures/check.png"/></Relationships>'),
    "3D/main.model": strToU8(`<model unit="inch" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" requiredextensions="m"><resources>
      <m:texture2d id="2" path="/3D/Textures/check.png" contenttype="image/png"/>
      <m:texture2dgroup id="3" texid="2"><m:tex2coord u="0" v="0"/><m:tex2coord u="1" v="0"/><m:tex2coord u="0" v="1"/></m:texture2dgroup>
      <object id="1" type="model" pid="3"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2" p1="0" p2="1" p3="2"/></triangles></mesh></object>
    </resources><build><item objectid="1"/></build></model>`),
    "3D/Textures/check.png": png,
  }).buffer as ArrayBuffer
}

export async function runThreeMfRuntimeChecks(target: HTMLElement) {
  const checks: string[] = []
  const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); checks.push(message) }
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 2
  const context = canvas.getContext("2d")!
  context.fillStyle = "#ff0000"; context.fillRect(0, 0, 2, 2)
  const png = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), "image/png"))
  const source = URL.createObjectURL(new Blob([texturedPackage(new Uint8Array(await png.arrayBuffer()))]))
  const controller = new AbortController()
  const viewport = new ModelScene(target)
  const loaded = await loadModel({ name: "textured.3mf", url: source, resourceUrl: () => { throw new Error("3MF must be self-contained") }, signal: controller.signal, renderer: viewport.renderer })
  try {
    check(loaded.metadata.unit.metersPerUnit === 0.0254 && loaded.metadata.unit.source === "format", "3MF: inch unit is retained without rescaling source coordinates")
    check(Math.abs(loaded.metadata.bounds.max.x - loaded.metadata.bounds.min.x - 1) < 1e-8, "3MF: model bounds remain in the declared source unit")
    let texture: Texture | undefined
    loaded.root.traverse((object) => {
      if (object instanceof Mesh) {
        const material = Array.isArray(object.material) ? object.material[0] : object.material
        if ("map" in material) texture = material.map as Texture
      }
    })
    check(texture?.image?.width === 2 && texture.image.height === 2, "3MF: embedded PNG finishes loading before the model becomes ready")
    viewport.setModel(loaded)
    viewport.renderer.render(viewport.scene, viewport.camera)
    check(viewport.renderer.info.render.triangles === 1, "3MF: real WebGL draws a textured mesh")
    check(viewport.view().camera.up.join(",") === "0,0,1", "3MF: camera uses Z-up without rotating model coordinates")
    const sourceTransform = loaded.root.matrixWorld.clone()
    checks.push(...await runModelNavigationChecks(viewport, "3MF"))
    loaded.root.updateMatrixWorld(true)
    check(loaded.root.matrixWorld.equals(sourceTransform), "3MF: free rotation leaves source geometry and measurement coordinates unchanged")
    viewport.fit("top")
    check(viewport.camera.position.z > viewport.controls.target.z, "3MF: top view looks down the source Z axis")
  } finally { loaded.dispose(); viewport.dispose(); controller.abort(); URL.revokeObjectURL(source) }
  check(target.querySelectorAll("canvas").length === 0, "3MF: closing the viewport releases its canvas")
  const closedPosition = viewport.camera.position.clone()
  viewport.renderer.domElement.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100 }))
  check(viewport.camera.position.equals(closedPosition), "3MF: disposed navigation no longer responds to input")

  const broken = URL.createObjectURL(new Blob([texturedPackage(new Uint8Array([1, 2, 3]))]))
  try {
    let rejected = false
    try {
      const model = await loadModel({ name: "broken.3mf", url: broken, resourceUrl: (path) => path, signal: new AbortController().signal })
      model.dispose()
    } catch (error) { rejected = error instanceof Error && error.message.includes("textures") }
    check(rejected, "3MF: invalid embedded images fail instead of silently dropping the texture")
  } finally { URL.revokeObjectURL(broken) }
  return checks
}
