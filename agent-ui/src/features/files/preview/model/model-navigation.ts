import { EventDispatcher, MOUSE, Quaternion, Vector3, type PerspectiveCamera } from "three"
import { TrackballControls } from "three/addons/controls/TrackballControls.js"

/** Keeps native trackball input event-driven and owns interrupted gesture cleanup. */
export class ModelNavigation extends EventDispatcher<{ change: {} }> {
  readonly target = new Vector3()
  minDistance = 0
  maxDistance = Infinity
  private controls: TrackballControls | null = null
  private active = true
  private disposed = false
  private pointers = new Map<number, PointerEvent>()
  private lastPosition = new Vector3()
  private lastQuaternion = new Quaternion()
  private lastUp = new Vector3()
  private lastTarget = new Vector3()
  private lastZoom = NaN

  constructor(private readonly camera: PerspectiveCamera, private readonly surface: HTMLElement) {
    super()
    this.createControls()
    surface.addEventListener("pointerdown", this.beforePointerDown, true)
    surface.addEventListener("pointercancel", this.pointerCancelled)
    surface.addEventListener("lostpointercapture", this.pointerCancelled)
    window.addEventListener("pointermove", this.afterPointerMove)
    window.addEventListener("pointerup", this.afterPointerUp)
    window.addEventListener("wheel", this.afterWheel, { passive: true })
    window.addEventListener("blur", this.cancelInteraction)
    this.update()
  }

  private createControls() {
    const controls = new TrackballControls(this.camera, this.surface)
    controls.staticMoving = true
    controls.keys = ["", "", ""]
    controls.target = this.target
    controls.minDistance = this.minDistance
    controls.maxDistance = this.maxDistance
    controls.update()
    this.controls = controls
  }

  private belongsToSurface(event: Event) { return event.composedPath().includes(this.surface) }

  private beforePointerDown = (event: PointerEvent) => {
    if (!this.active || this.disposed || !this.controls) return
    this.handleResize()
    this.pointers.set(event.pointerId, event)
    this.controls.mouseButtons.LEFT = event.ctrlKey || event.metaKey || event.shiftKey ? MOUSE.PAN : MOUSE.ROTATE
  }

  // Window bubbling runs after native canvas listeners, including those added on pointerdown.
  private afterPointerMove = (event: PointerEvent) => {
    if (!this.active || !this.pointers.has(event.pointerId) || !this.belongsToSurface(event)) return
    this.pointers.set(event.pointerId, event)
    this.update()
  }

  private afterPointerUp = (event: PointerEvent) => {
    if (!this.pointers.has(event.pointerId) || !this.belongsToSurface(event)) return
    this.update()
    this.pointers.delete(event.pointerId)
    if (event.pointerType === "touch") {
      // r180 ends a touch using the pointer count before removal. Restart remaining fingers
      // through public DOM input so pinch-to-single-finger transitions have fresh state.
      const remaining = [...this.pointers.values()]
      this.clearInteraction()
      if (this.active && !this.disposed) {
        this.createControls()
        for (const pointer of remaining) this.surface.dispatchEvent(this.pointerEvent("pointerdown", pointer, false))
      }
    }
  }

  private afterWheel = (event: WheelEvent) => {
    if (this.active && this.belongsToSurface(event)) this.update()
  }

  private pointerCancelled = (event: PointerEvent) => {
    // Rebuilding a pinch as a single-finger drag can release and recapture the same ID.
    if (event.type === "lostpointercapture" && this.surface.hasPointerCapture(event.pointerId)) return
    if (this.pointers.has(event.pointerId)) this.cancelInteraction()
  }

  private pointerEvent(type: string, pointer: PointerEvent, bubbles: boolean) {
    return new PointerEvent(type, {
      bubbles, pointerId: pointer.pointerId, pointerType: pointer.pointerType, isPrimary: pointer.isPrimary,
      clientX: pointer.clientX, clientY: pointer.clientY, button: 0, buttons: type === "pointerdown" ? 1 : 0,
    })
  }

  private clearInteraction() {
    const pointers = [...this.pointers.values()]
    this.pointers.clear()
    this.controls?.dispose()
    this.controls = null
    for (const pointer of pointers) {
      if (this.surface.hasPointerCapture(pointer.pointerId)) this.surface.releasePointerCapture(pointer.pointerId)
      // Also clear the React selection gesture; a cancelled drag must never become a click.
      this.surface.dispatchEvent(this.pointerEvent("pointercancel", pointer, true))
    }
  }

  private cancelInteraction = () => {
    if (this.disposed || !this.pointers.size) return
    this.clearInteraction()
    if (this.active) this.createControls()
  }

  setActive(active: boolean) {
    if (this.disposed || this.active === active) return
    this.active = active
    if (active) { this.createControls(); this.handleResize() }
    else this.clearInteraction()
  }

  handleResize() { this.controls?.handleResize() }

  update() {
    if (this.disposed) return
    if (this.controls) {
      this.controls.minDistance = this.minDistance
      this.controls.maxDistance = this.maxDistance
      this.controls.update()
    }
    // Native change detection uses a world-space epsilon, which misses small CAD models.
    // Compare against the last published view to include external fit, restore and zoom.
    if (this.lastPosition.equals(this.camera.position) && this.lastQuaternion.equals(this.camera.quaternion)
      && this.lastUp.equals(this.camera.up) && this.lastTarget.equals(this.target) && this.lastZoom === this.camera.zoom) return
    this.lastPosition.copy(this.camera.position)
    this.lastQuaternion.copy(this.camera.quaternion)
    this.lastUp.copy(this.camera.up)
    this.lastTarget.copy(this.target)
    this.lastZoom = this.camera.zoom
    this.dispatchEvent({ type: "change" })
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.clearInteraction()
    this.surface.removeEventListener("pointerdown", this.beforePointerDown, true)
    this.surface.removeEventListener("pointercancel", this.pointerCancelled)
    this.surface.removeEventListener("lostpointercapture", this.pointerCancelled)
    window.removeEventListener("pointermove", this.afterPointerMove)
    window.removeEventListener("pointerup", this.afterPointerUp)
    window.removeEventListener("wheel", this.afterWheel)
    window.removeEventListener("blur", this.cancelInteraction)
  }
}
