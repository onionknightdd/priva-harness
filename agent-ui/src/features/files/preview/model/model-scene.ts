import {
  ACESFilmicToneMapping, AnimationMixer, Box3, BoxHelper, BufferAttribute, BufferGeometry, Color, DirectionalLight, Group,
  HemisphereLight, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, PerspectiveCamera,
  Plane, Points, PointsMaterial, Raycaster, Scene, Sphere, SphereGeometry, SRGBColorSpace, Vector2,
  Vector3, WebGLRenderer, PMREMGenerator, type WebGLRenderTarget, type Object3D, type Material,
} from "three"
import { ModelNavigation } from "./model-navigation"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"
import type { ModelAnchor, ModelFileAnnotation, ModelVector3 } from "@/features/agent-message/file-annotation"
import type { LoadedModel } from "./model-types"

export type CameraView = ModelFileAnnotation["view"]["camera"]
export type ClipView = NonNullable<ModelFileAnnotation["view"]["clipping"]>
export type ModelSceneDriver = {
  renderer: WebGLRenderer
  scene: Scene
  camera: PerspectiveCamera
  controls: ModelNavigation
  requestRender: () => void
  setVisible: (visible: boolean) => void
  dispose: () => void
  pick?: (x: number, y: number) => ModelAnchor | null
  setClippingPlanes?: (planes: Plane[]) => void
  setPointSize?: (size: number) => void
  setPointColor?: (color: "original" | "solid" | "height") => void
  setPointBudget?: (count: number) => void
  getDisplayedPointCount?: () => number
}

function visibleInHierarchy(object: Object3D) {
  for (let current: Object3D | null = object; current; current = current.parent) if (!current.visible) return false
  return true
}

/** Owns only viewport resources. Imported model resources remain loader-owned. */
export class ModelScene {
  readonly renderer: WebGLRenderer
  readonly scene: Scene
  readonly camera: PerspectiveCamera
  readonly controls: ModelNavigation
  readonly bounds = new Box3()
  readonly origin = new Vector3()
  readonly overlay = new Group()
  private root: Object3D | null = null
  private raycaster = new Raycaster()
  private frame = 0
  private visible = true
  private disposed = false
  private mixer: AnimationMixer | null = null
  private playing = false
  private lastFrame = 0
  private clip: Plane | null = null
  private outline: BoxHelper | null = null
  private markers = new Group()
  private resize: ResizeObserver
  private pointsOriginalColors = new Map<Points, Float32Array | null>()
  private environment: WebGLRenderTarget | null = null
  private readonly defaultUp: Vector3

  constructor(readonly host: HTMLElement, private driver?: ModelSceneDriver, private onViewChange?: () => void) {
    this.renderer = driver?.renderer ?? new WebGLRenderer({ antialias: true, alpha: false })
    this.scene = driver?.scene ?? new Scene()
    this.camera = driver?.camera ?? new PerspectiveCamera(45, 1, 0.01, 100000)
    this.defaultUp = this.camera.up.clone()
    this.controls = driver?.controls ?? new ModelNavigation(this.camera, this.renderer.domElement)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.localClippingEnabled = true
    this.renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline:none"
    if (!driver) {
      host.append(this.renderer.domElement)
      this.scene.add(new HemisphereLight(0xffffff, 0x566078, 2.5))
      const light = new DirectionalLight(0xffffff, 3)
      light.position.set(2, 4, 3)
      this.scene.add(light)
      const pmrem = new PMREMGenerator(this.renderer)
      const room = new RoomEnvironment()
      this.environment = pmrem.fromScene(room)
      this.scene.environment = this.environment.texture
      room.dispose(); pmrem.dispose()
      this.renderer.toneMapping = ACESFilmicToneMapping
    }
    this.scene.add(this.overlay)
    this.overlay.add(this.markers)
    this.controls.addEventListener("change", this.changed)
    this.resize = new ResizeObserver(this.resizeViewport)
    this.resize.observe(host)
    document.addEventListener("visibilitychange", this.visibilityChanged)
    this.resizeViewport()
  }

  private changed = () => { this.requestRender(); this.onViewChange?.() }
  private visibilityChanged = () => {
    this.controls.setActive(this.visible && !document.hidden)
    this.driver?.setVisible(this.visible && !document.hidden)
    if (document.hidden) { cancelAnimationFrame(this.frame); this.frame = 0 }
    else this.requestRender()
  }
  private resizeViewport = () => {
    const { width, height } = this.host.getBoundingClientRect()
    if (!width || !height || this.disposed) return
    if (!this.driver) {
      this.renderer.setSize(width, height, false)
      this.camera.aspect = width / height
      this.camera.updateProjectionMatrix()
    }
    this.controls.handleResize()
    this.requestRender()
  }

  setTheme() {
    // Let the browser resolve theme tokens (including OKLCH) to sRGB for WebGL.
    const context = document.createElement("canvas").getContext("2d")
    if (context) {
      context.fillStyle = getComputedStyle(this.host).backgroundColor
      context.fillRect(0, 0, 1, 1)
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data
      this.scene.background = new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace)
    }
    this.requestRender()
  }

  setModel(model: LoadedModel) {
    this.defaultUp.set(0, model.metadata.format === "3mf" ? 0 : 1, model.metadata.format === "3mf" ? 1 : 0)
    this.root = model.root
    this.scene.add(model.root)
    this.origin.fromArray(model.metadata.origin)
    this.bounds.copy(model.metadata.bounds)
    if (model.animations.length) {
      this.mixer = new AnimationMixer(model.root)
      for (const clip of model.animations) this.mixer.clipAction(clip).play()
    }
    this.fit()
  }

  setPointCloud(bounds: Box3, origin: ModelVector3) {
    this.bounds.copy(bounds)
    this.origin.fromArray(origin)
    this.fit()
  }

  setVisible(visible: boolean) {
    this.visible = visible
    this.controls.setActive(visible && !document.hidden)
    this.driver?.setVisible(visible && !document.hidden)
    if (!visible) { cancelAnimationFrame(this.frame); this.frame = 0; this.lastFrame = 0 }
    else this.resizeViewport()
  }

  requestRender = () => {
    if (this.disposed || !this.visible || document.hidden || this.frame) return
    this.frame = requestAnimationFrame((time) => {
      this.frame = 0
      if (this.disposed || !this.visible || document.hidden) return
      if (this.playing && this.mixer) {
        this.mixer.update(this.lastFrame ? Math.min((time - this.lastFrame) / 1000, 0.1) : 0)
        this.lastFrame = time
      }
      this.outline?.update()
      if (this.driver) this.driver.requestRender()
      else this.renderer.render(this.scene, this.camera)
      if (this.playing) this.requestRender()
    })
  }

  setPlaying(value: boolean) { this.playing = value; this.lastFrame = 0; this.requestRender() }

  fit(direction: "fit" | "front" | "top" | "right" = "fit") {
    if (this.bounds.isEmpty()) return
    const sphere = this.bounds.getBoundingSphere(new Sphere())
    const radius = Math.max(sphere.radius, 1e-6)
    const vertical = this.camera.fov * Math.PI / 360
    const horizontal = Math.atan(Math.tan(vertical) * Math.max(this.camera.aspect, 0.1))
    const distance = radius / Math.sin(Math.min(vertical, horizontal)) * 1.15
    const zUp = Math.abs(this.defaultUp.z) > 0.9
    const axis = direction === "front" ? (zUp ? new Vector3(0, -1, 0) : new Vector3(0, 0, 1))
      : direction === "top" ? (zUp ? new Vector3(0, -0.001, 1) : new Vector3(0, 1, 0.001))
      : direction === "right" ? new Vector3(1, 0, 0) : (zUp ? new Vector3(1, -1, 0.7) : new Vector3(1, 0.7, 1)).normalize()
    this.controls.target.copy(sphere.center)
    this.camera.up.copy(this.defaultUp)
    this.camera.position.copy(sphere.center).addScaledVector(axis, distance)
    this.camera.near = Math.max(radius / 10000, 1e-8)
    this.camera.far = Math.max(radius * 10000, 1)
    this.camera.updateProjectionMatrix()
    this.controls.maxDistance = radius * 1000
    this.controls.minDistance = radius * 0.001
    this.controls.update()
    this.requestRender()
  }

  view(): ModelFileAnnotation["view"] {
    return {
      camera: { position: this.camera.position.clone().add(this.origin).toArray(), target: this.controls.target.clone().add(this.origin).toArray(), up: this.camera.up.toArray(), projection: "perspective", zoom: this.camera.zoom },
      ...(this.mixer ? { animationTime: this.mixer.time } : {}),
      ...(this.clip ? { clipping: { normal: this.clip.normal.toArray(), constant: this.clip.constant - this.clip.normal.dot(this.origin) } } : {}),
    }
  }

  restore(view: ModelFileAnnotation["view"]) {
    this.mixer?.setTime(view.animationTime ?? 0)
    this.camera.position.fromArray(view.camera.position).sub(this.origin)
    this.camera.up.fromArray(view.camera.up)
    this.camera.zoom = view.camera.zoom
    this.controls.target.fromArray(view.camera.target).sub(this.origin)
    this.camera.updateProjectionMatrix()
    this.controls.update()
    this.setClip(view.clipping ?? null)
    this.requestRender()
  }

  /** Public plane constants and anchors are always in original source coordinates. */
  setClip(plane: ClipView | null) {
    this.clip = plane ? new Plane(new Vector3().fromArray(plane.normal), plane.constant + new Vector3().fromArray(plane.normal).dot(this.origin)) : null
    this.renderer.clippingPlanes = this.clip ? [this.clip] : []
    this.driver?.setClippingPlanes?.(this.renderer.clippingPlanes)
    this.requestRender()
  }

  pick(clientX: number, clientY: number): ModelAnchor | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    if (this.driver?.pick) {
      const hit = this.driver.pick(clientX - rect.left, clientY - rect.top)
      if (hit && (!this.clip || this.clip.distanceToPoint(new Vector3().fromArray(hit.position).sub(this.origin)) >= 0)) return hit
      return null
    }
    if (!this.root) return null
    this.scene.updateMatrixWorld(true)
    this.raycaster.setFromCamera(new Vector2((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2), this.camera)
    this.raycaster.params.Points.threshold = 8 * 2 * this.camera.position.distanceTo(this.controls.target) * Math.tan(this.camera.fov * Math.PI / 360) / rect.height
    for (const hit of this.raycaster.intersectObject(this.root, true)) {
      if (!visibleInHierarchy(hit.object)) continue
      // Points.raycast returns the projection onto the ray. Measurements use the actual vertex.
      const point = hit.object instanceof Points && hit.index !== undefined
        ? new Vector3().fromBufferAttribute(hit.object.geometry.getAttribute("position"), hit.index).applyMatrix4(hit.object.matrixWorld)
        : hit.point
      if (this.clip && this.clip.distanceToPoint(point) < 0) continue
      return {
        position: point.clone().add(this.origin).toArray(),
        locator: { sourceNodePath: hit.object.userData.sourceNodePath ?? [], ...(hit.object instanceof Points ? { vertexIndex: hit.index } : { faceIndex: hit.faceIndex ?? undefined }), ...(hit.instanceId === undefined ? {} : { instanceIndex: hit.instanceId }) },
      }
    }
    return null
  }

  private find(path: number[]) {
    let node = this.root
    for (const index of path) node = node?.children[index] ?? null
    return node
  }

  select(anchor: ModelAnchor | null) {
    if (this.outline) { this.overlay.remove(this.outline); this.outline.geometry.dispose(); (this.outline.material as Material).dispose(); this.outline = null }
    if (anchor) {
      const object = this.find(anchor.locator.sourceNodePath)
      if (object) { this.outline = new BoxHelper(object, 0x0285f7); this.overlay.add(this.outline) }
    }
    this.requestRender()
  }

  showAnchors(anchors: ModelAnchor[]) {
    this.markers.traverse((object) => {
      if (object instanceof Mesh || object instanceof Line) { object.geometry.dispose(); (object.material as Material).dispose() }
    })
    this.markers.clear()
    const points = anchors.map((anchor) => new Vector3().fromArray(anchor.position).sub(this.origin))
    if (points.length > 1) this.markers.add(new Line(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color: 0x0285f7, depthTest: false, transparent: true })))
    const radius = Math.max(this.bounds.getSize(new Vector3()).length() * 0.004, 1e-8)
    for (const point of points) {
      const marker = new Mesh(new SphereGeometry(radius, 12, 8), new MeshBasicMaterial({ color: 0x0285f7, depthTest: false, transparent: true }))
      marker.position.copy(point); marker.renderOrder = 2; this.markers.add(marker)
    }
    this.requestRender()
  }

  setObjectVisibility(path: number[], action: "hide" | "isolate" | "showAll") {
    const selected = this.find(path)
    this.root?.traverse((object) => {
      if (action === "showAll") object.visible = true
      else if (action === "isolate" && (object instanceof Mesh || object instanceof Points)) object.visible = object === selected
    })
    if (action === "hide" && selected) selected.visible = false
    this.select(null)
    this.requestRender()
  }

  setPointSize(size: number) {
    this.driver?.setPointSize?.(size)
    this.root?.traverse((object) => {
      if (object instanceof Points && object.material instanceof PointsMaterial) { object.material.size = size; object.material.sizeAttenuation = false }
    })
    this.requestRender()
  }

  setPointColor(mode: "original" | "solid" | "height") {
    this.driver?.setPointColor?.(mode)
    this.root?.traverse((object) => {
      if (!(object instanceof Points) || !(object.material instanceof PointsMaterial)) return
      const positions = object.geometry.getAttribute("position")
      let colorAttribute = object.geometry.getAttribute("color")
      if (!this.pointsOriginalColors.has(object)) {
        const original = colorAttribute ? new Float32Array(positions.count * 3) : null
        if (original) for (let i = 0; i < positions.count; i++) original.set([colorAttribute.getX(i), colorAttribute.getY(i), colorAttribute.getZ(i)], i * 3)
        this.pointsOriginalColors.set(object, original)
      }
      if (mode === "original") {
        const original = this.pointsOriginalColors.get(object)
        if (original) {
          for (let i = 0; i < positions.count; i++) colorAttribute.setXYZ(i, original[i * 3], original[i * 3 + 1], original[i * 3 + 2])
          colorAttribute.needsUpdate = true
        }
        object.material.vertexColors = Boolean(original)
      } else if (mode === "solid") object.material.vertexColors = false
      else {
        if (!colorAttribute) {
          colorAttribute = new BufferAttribute(new Float32Array(positions.count * 3), 3)
          object.geometry.setAttribute("color", colorAttribute)
        }
        const color = new Color()
        const span = this.bounds.max.z - this.bounds.min.z || 1
        const point = new Vector3()
        object.updateWorldMatrix(true, false)
        for (let i = 0; i < positions.count; i++) {
          point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld)
          color.setHSL((1 - Math.max(0, Math.min(1, (point.z - this.bounds.min.z) / span))) * 0.7, 0.75, 0.5)
          colorAttribute.setXYZ(i, color.r, color.g, color.b)
        }
        colorAttribute.needsUpdate = true
        object.material.vertexColors = true
      }
      object.material.needsUpdate = true
    })
    this.requestRender()
  }

  zoom(factor: number) {
    this.camera.position.sub(this.controls.target).multiplyScalar(factor).add(this.controls.target)
    this.controls.update()
  }

  setPointBudget(count: number) { this.driver?.setPointBudget?.(count) }
  displayedPointCount() { return this.driver?.getDisplayedPointCount?.() }

  async screenshot(): Promise<Blob> {
    if (this.driver) this.driver.requestRender()
    this.renderer.render(this.scene, this.camera)
    return new Promise((resolve, reject) => this.renderer.domElement.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Screenshot could not be captured")), "image/png"))
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.resize.disconnect()
    document.removeEventListener("visibilitychange", this.visibilityChanged)
    this.controls.removeEventListener("change", this.changed)
    this.showAnchors([])
    this.select(null)
    this.scene.remove(this.overlay)
    if (this.root) this.scene.remove(this.root)
    this.mixer?.stopAllAction()
    if (this.root) this.mixer?.uncacheRoot(this.root)
    this.pointsOriginalColors.clear()
    this.environment?.dispose()
    if (this.driver) this.driver.dispose()
    else { this.controls.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove() }
  }
}
