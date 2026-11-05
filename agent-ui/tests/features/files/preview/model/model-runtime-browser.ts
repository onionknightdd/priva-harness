import { AmbientLight, DirectionalLight, PerspectiveCamera, Plane, Scene, Vector3, WebGLRenderer } from "three"
import stepSource from "occt-import-js/test/testfiles/simple-basic-cube/cube.stp?raw"
import igesSource from "occt-import-js/test/testfiles/cube-10x10mm/Cube 10x10.igs?raw"
import copcUrl from "./fixtures/color.copc.laz?url"
import { loadModel } from "../../../../../src/features/files/preview/model/model-loader"
import { createPointCloudOwner } from "../../../../../src/features/files/preview/model/model-pointcloud"
import { runThreeMfRuntimeChecks } from "./model-3mf-browser"
import { ModelScene } from "../../../../../src/features/files/preview/model/model-scene"
import { runModelNavigationChecks } from "./model-navigation-browser"

const target = document.querySelector<HTMLDivElement>("#viewport")!
const status = document.querySelector<HTMLPreElement>("#status")!
const checks: string[] = []
function check(condition: unknown, name: string) { if (!condition) throw new Error(name); checks.push(name); status.textContent = checks.join("\n") }
const wait = (duration: number) => new Promise((resolve) => setTimeout(resolve, duration))

async function run() {
  checks.length = 0
  status.textContent = "Running real 3MF checks…"
  checks.push(...await runThreeMfRuntimeChecks(target))
  status.textContent = "Running real CAD workers…"
  for (const [name, text] of [["cube.step", stepSource], ["cube.iges", igesSource]]) {
    const url = URL.createObjectURL(new Blob([text]))
    const renderer = new WebGLRenderer({ antialias: true })
    renderer.setSize(800, 500)
    target.appendChild(renderer.domElement)
    const controller = new AbortController()
    try {
      const model = await loadModel({ name, url, resourceUrl: () => { throw new Error("CAD fixture has no external resources") }, signal: controller.signal, renderer })
      check(model.metadata.triangleCount >= 12, `${name}: worker triangulated real CAD surfaces`)
      check(model.metadata.unit.metersPerUnit === 1, `${name}: OCCT output is metric`)
      const scene = new Scene()
      scene.add(model.root, new AmbientLight(0xffffff, 2))
      const light = new DirectionalLight(0xffffff, 3); light.position.set(2, 3, 4); scene.add(light)
      const radius = model.metadata.bounds.getSize(new Vector3()).length()
      const camera = new PerspectiveCamera(45, 800 / 500, radius / 100, radius * 100)
      camera.position.set(radius, radius, radius); camera.lookAt(0, 0, 0)
      renderer.render(scene, camera)
      check(renderer.info.render.triangles >= 12, `${name}: WebGL drew triangles`)
      model.dispose()
    } finally { controller.abort(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); URL.revokeObjectURL(url) }
  }
  status.textContent += "\nLoading real COPC / LAZ worker…"
  const controller = new AbortController()
  const errors: Error[] = []
  const owner = await createPointCloudOwner({ target, signal: controller.signal, source: { url: copcUrl, revision: "c94fa8dfe14ce7bff074231ce9e8aa36f7200342a4ff675c2902205f40e72728" }, onError: (error) => errors.push(error) })
  try {
    const deadline = performance.now() + 15_000
    while (owner.getDisplayedPointCount() === 0 && !errors.length && performance.now() < deadline) { owner.requestRender(); await wait(100) }
    if (errors.length) throw errors[0]
    check(owner.metadata.pointCount > 0, "COPC: metadata and spatial hierarchy decoded")
    check(owner.getDisplayedPointCount() > 0, "COPC: worker decoded point nodes")
    check(owner.renderer.info.render.points > 0, "COPC: WebGL rendered real point data")
    check(owner.origin.some((component) => Math.abs(component) > 1000), "COPC: source coordinates retained in double-precision origin")
    check(owner.bounds.getCenter(new Vector3()).length() < 0.001, "COPC: view and LOD bounds use local coordinates")
    owner.setPointColor("height"); owner.setPointSize(4); owner.requestRender(); await wait(200)
    check(owner.renderer.info.render.points > 0, "COPC: height color and point size render")
    owner.setPointColor("solid"); owner.requestRender(); await wait(200)
    owner.setPointColor("original"); owner.requestRender(); await wait(200)
    let pick = null
    for (let y = 50; y < 500 && !pick; y += 20) for (let x = 50; x < 800 && !pick; x += 20) pick = owner.pick(x, y)
    check(pick?.nodeId && pick.vertexIndex !== undefined, "COPC: GPU pick returns a stable node ID and node-local point index")
    owner.setClippingPlanes([new Plane(new Vector3(0, 0, 1), 0)]); owner.requestRender(); await wait(200)
    check(owner.renderer.info.render.points > 0, "COPC: clipping renders without shader errors")
    owner.setClippingPlanes([])
    owner.setVisible(false); await wait(200)
    owner.setVisible(true); owner.requestRender(); await wait(500)
    check(errors.length === 0, "COPC: hide/show preserves a usable owner")
    const viewport = new ModelScene(target, {
      renderer: owner.renderer, scene: owner.scene, camera: owner.camera, controls: owner.controls,
      requestRender: owner.requestRender, setVisible: owner.setVisible, dispose: owner.dispose,
    })
    try {
      viewport.setPointCloud(owner.bounds, owner.origin)
      checks.push(...await runModelNavigationChecks(viewport, "COPC"))
    } finally { viewport.dispose() }
  } finally { owner.dispose(); controller.abort() }
  check(target.querySelectorAll("canvas").length === 0, "dispose removes runtime canvases")
  const cancellation = new AbortController()
  let rejected = false
  try {
    await createPointCloudOwner({ target, signal: cancellation.signal, source: { url: copcUrl, revision: "fixture" }, onProgress: () => cancellation.abort() })
  } catch (error) { rejected = error instanceof DOMException && error.name === "AbortError" }
  await wait(100)
  check(rejected && target.querySelectorAll("canvas").length === 0, "COPC: cancellation rejects and leaves no renderer")
  status.textContent = "PASS\n" + checks.join("\n")
  return checks
}

Object.assign(window, { runModelRuntimeChecks: run, runThreeMfRuntimeChecks: () => runThreeMfRuntimeChecks(target) })
document.querySelector("#run")!.addEventListener("click", () => { void run().catch((error) => { status.textContent = `FAIL: ${error.stack ?? error}` }) })
