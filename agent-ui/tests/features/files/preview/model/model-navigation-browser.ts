import { Vector3 } from "three"
import type { ModelScene } from "../../../../../src/features/files/preview/model/model-scene"

/** Exercises the same navigation through real DOM events for mesh and COPC viewports. */
export async function runModelNavigationChecks(viewport: ModelScene, prefix: string) {
  const checks: string[] = []
  const check = (condition: unknown, message: string) => { if (!condition) throw new Error(`${prefix}: ${message}`); checks.push(`${prefix}: ${message}`) }
  const surface = viewport.renderer.domElement
  const originalView = viewport.view()
  const originalUp = viewport.camera.up.clone()
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  const pose = () => [...viewport.camera.position.toArray(), ...viewport.camera.up.toArray(), ...viewport.controls.target.toArray()]
  const close = (left: number[], right: number[], tolerance = 1e-8) => left.every((value, index) => Math.abs(value - right[index]) < tolerance)
  const pointer = (type: string, x: number, y: number, options: PointerEventInit = {}) => surface.dispatchEvent(new PointerEvent(type, {
    bubbles: true, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
    clientX: x, clientY: y, ...options,
  }))
  const drag = (dx: number, dy: number, options: PointerEventInit = {}) => {
    const rect = surface.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    pointer("pointerdown", x, y, options)
    try {
      // Several moves in one task must all be applied, even without a rendering frame.
      for (let step = 1; step <= 8; step++) pointer("pointermove", x + dx * step / 8, y + dy * step / 8, options)
    } finally { pointer("pointerup", x + dx, y + dy, { ...options, buttons: 0 }) }
  }
  const rect = surface.getBoundingClientRect()
  check(rect.width > 0 && rect.height > 0 && rect.left !== 0 && rect.top !== 0, "navigation uses a visible canvas offset from the page origin")

  viewport.fit("front")
  const distance = viewport.camera.position.distanceTo(viewport.controls.target)
  const target = viewport.controls.target.clone()
  drag(0, rect.width * 1.1)
  check(viewport.camera.up.dot(originalUp) < -0.3, "vertical dragging can turn the camera upside down without a pole lock")
  check(Math.abs(viewport.camera.position.distanceTo(viewport.controls.target) - distance) < distance * 1e-8 && viewport.controls.target.distanceTo(target) < distance * 1e-8, "free rotation preserves orbit distance and target")

  viewport.fit("front")
  const right = new Vector3(1, 0, 0).applyQuaternion(viewport.camera.quaternion)
  drag(rect.width * 0.3, 0)
  drag(0, rect.width * 0.4)
  check(Math.abs(viewport.camera.up.dot(right)) > 0.2, "successive horizontal and vertical drags retain a freely tilted up direction")
  const rolled = pose()
  viewport.controls.update()
  viewport.controls.update()
  check(close(pose(), rolled), "idle updates preserve the rotated view without inertia or snap-back")

  const positionBeforePan = viewport.camera.position.clone()
  const targetBeforePan = viewport.controls.target.clone()
  const upBeforePan = viewport.camera.up.clone()
  drag(rect.width * 0.12, rect.height * 0.08, { button: 2, buttons: 2 })
  const panDelta = viewport.controls.target.clone().sub(targetBeforePan)
  check(panDelta.length() > distance * 0.01 && viewport.camera.position.clone().sub(positionBeforePan).distanceTo(panDelta) < distance * 1e-8 && viewport.camera.up.distanceTo(upBeforePan) < 1e-8, "right drag pans camera and actual target together without changing orientation")
  const saved = viewport.view()
  const savedPose = pose()
  viewport.fit()
  check(viewport.camera.up.distanceTo(originalUp) < 1e-8, "standard view restores the file's default up direction")
  viewport.restore(saved)
  check(close(pose(), savedPose), "saved views restore both roll and the panned target")
  drag(0, 0)
  check(close(pose(), savedPose), "starting a new gesture after restore does not jump")

  const beforeZoom = viewport.camera.position.distanceTo(viewport.controls.target)
  const zoomTarget = viewport.controls.target.clone()
  surface.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100, deltaMode: 0 }))
  check(Math.abs(viewport.camera.position.distanceTo(viewport.controls.target) - beforeZoom) > beforeZoom * 0.01 && viewport.controls.target.distanceTo(zoomTarget) < 1e-8, "wheel zoom works around the panned target")
  const beforeModifiedPan = viewport.controls.target.clone()
  drag(rect.width * 0.1, 0, { shiftKey: true })
  check(viewport.controls.target.distanceTo(beforeModifiedPan) > distance * 0.01, "Shift and left drag retain the existing pan shortcut")

  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  pointer("pointerdown", centerX, centerY)
  pointer("pointermove", centerX + 20, centerY + 10)
  viewport.setVisible(false)
  const hiddenPose = pose()
  pointer("pointermove", centerX + 140, centerY + 80)
  pointer("pointerup", centerX + 140, centerY + 80)
  viewport.setVisible(true)
  pointer("pointermove", centerX + 180, centerY + 100, { buttons: 0 })
  check(close(pose(), hiddenPose), "hiding during a drag cancels the gesture and prevents a stale drag after showing")
  drag(40, 30)
  check(!close(pose(), hiddenPose), "a new drag still works after hiding and showing")
  pointer("pointerdown", centerX, centerY)
  pointer("pointermove", centerX + 15, centerY + 15)
  pointer("pointercancel", centerX + 15, centerY + 15)
  const cancelledPose = pose()
  pointer("pointermove", centerX + 130, centerY + 90, { buttons: 0 })
  check(close(pose(), cancelledPose), "pointer cancellation stops the previous drag")
  drag(35, -20)
  check(!close(pose(), cancelledPose), "navigation remains usable after pointer cancellation")

  const beforeTouch = pose()
  drag(55, 40, { pointerType: "touch" })
  check(!close(pose(), beforeTouch), "one-finger dragging freely rotates the camera")
  const pinchDistance = viewport.camera.position.distanceTo(viewport.controls.target)
  pointer("pointerdown", centerX - 50, centerY, { pointerType: "touch" })
  pointer("pointerdown", centerX + 50, centerY, { pointerType: "touch", pointerId: 2, isPrimary: false })
  pointer("pointermove", centerX - 90, centerY + 20, { pointerType: "touch" })
  pointer("pointermove", centerX + 90, centerY + 20, { pointerType: "touch", pointerId: 2, isPrimary: false })
  pointer("pointerup", centerX + 90, centerY + 20, { pointerType: "touch", pointerId: 2, isPrimary: false })
  check(viewport.camera.position.distanceTo(viewport.controls.target) < pinchDistance * 0.8, "two-finger pinch zooms without requiring a continuous rendering loop")
  await frame()
  const singleFingerDistance = viewport.camera.position.distanceTo(viewport.controls.target)
  const singleFingerUp = viewport.camera.up.clone()
  pointer("pointermove", centerX - 60, centerY + 45, { pointerType: "touch" })
  pointer("pointerup", centerX - 60, centerY + 45, { pointerType: "touch" })
  check(viewport.camera.up.distanceTo(singleFingerUp) > 0.01 && Math.abs(viewport.camera.position.distanceTo(viewport.controls.target) - singleFingerDistance) < singleFingerDistance * 1e-8, "lifting one finger switches pinch back to rotation without a zoom jump")

  const hostStyle = viewport.host.getAttribute("style")
  try {
    viewport.host.style.width = `${rect.width * 0.8}px`
    viewport.host.style.marginLeft = "43px"
    await frame(); await frame()
    const movedRect = surface.getBoundingClientRect()
    check(movedRect.width < rect.width && movedRect.left !== rect.left, "navigation is checked after a container resize and move")
    viewport.fit("front")
    drag(0, movedRect.width * 1.1)
    check(viewport.camera.up.dot(originalUp) < -0.3, "resized and moved canvases retain the same free-rotation gesture")
  } finally {
    if (hostStyle === null) viewport.host.removeAttribute("style")
    else viewport.host.setAttribute("style", hostStyle)
    await frame(); await frame()
    viewport.restore(originalView)
  }
  const minimumDistance = viewport.controls.minDistance
  const maximumDistance = viewport.controls.maxDistance
  let tinyChanges = 0
  const tinyChange = () => { tinyChanges++ }
  try {
    viewport.controls.minDistance = 1e-12
    viewport.controls.maxDistance = 1
    viewport.camera.position.sub(viewport.controls.target).setLength(1e-5).add(viewport.controls.target)
    viewport.controls.update()
    viewport.controls.addEventListener("change", tinyChange)
    drag(2, 1)
    check(tinyChanges > 0, "small engineering models still emit a view change for short drags")
  } finally {
    viewport.controls.removeEventListener("change", tinyChange)
    viewport.controls.minDistance = minimumDistance
    viewport.controls.maxDistance = maximumDistance
    viewport.restore(originalView)
  }
  return checks
}
