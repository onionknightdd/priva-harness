import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"

const views = new Set<{ dispose(): void; setVisible(visible: boolean): void }>()
let hostVisible = true

/** A sandbox-owned scene: disposal also runs when generated code is replaced. */
export function createThreeScene(container: HTMLElement) {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000)
  camera.position.set(3, 2, 3)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
  renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none"
  container.append(renderer.domElement)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 0, 0)
  controls.update()
  let visible = hostVisible && !document.hidden
  controls.enabled = visible
  let disposed = false
  let pendingFrame = 0
  let previous = 0
  let animate: ((deltaSeconds: number) => void) | null = null
  const draw = () => { if (!disposed && visible) renderer.render(scene, camera) }
  const requestRender = () => {
    if (disposed || !visible || pendingFrame) return
    pendingFrame = requestAnimationFrame(() => { pendingFrame = 0; draw() })
  }
  const synchronizeAnimation = () => {
    previous = 0
    renderer.setAnimationLoop(!disposed && visible && animate ? (time) => {
      animate?.(previous ? Math.min((time - previous) / 1000, 0.1) : 0)
      previous = time
      draw()
    } : null)
  }
  const resize = new ResizeObserver(() => {
    const { width, height } = container.getBoundingClientRect()
    if (!width || !height) return
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    requestRender()
  })
  resize.observe(container)
  controls.addEventListener("change", requestRender)
  const view = {
    scene, camera, renderer, controls, requestRender,
    setAnimation(callback: ((deltaSeconds: number) => void) | null) { if (!disposed) { animate = callback; synchronizeAnimation() } },
    setVisible(value: boolean) {
      const next = value && !document.hidden
      if (disposed || visible === next) return
      visible = next
      controls.enabled = visible
      if (!visible) { cancelAnimationFrame(pendingFrame); pendingFrame = 0 }
      synchronizeAnimation()
      requestRender()
    },
    dispose() {
      if (disposed) return
      disposed = true
      renderer.setAnimationLoop(null)
      cancelAnimationFrame(pendingFrame)
      resize.disconnect()
      controls.dispose()
      const resources = new Set<{ dispose(): void }>()
      const addTexture = (value: unknown) => {
        if (value instanceof THREE.Texture) resources.add(value)
        else if (Array.isArray(value)) value.forEach(addTexture)
      }
      addTexture(scene.background)
      addTexture(scene.environment)
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (mesh.geometry) resources.add(mesh.geometry)
        if (object instanceof THREE.SkinnedMesh) resources.add(object.skeleton)
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (!material) continue
          resources.add(material)
          for (const value of Object.values(material)) addTexture(value)
          if (material instanceof THREE.ShaderMaterial) {
            for (const uniform of Object.values(material.uniforms)) addTexture(uniform.value)
          }
        }
      })
      for (const resource of resources) resource.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
      views.delete(view)
    },
  }
  views.add(view)
  requestRender()
  return view
}

export function disposeThreeScenes() { for (const view of [...views]) view.dispose() }
export function setThreeScenesVisible(visible: boolean) {
  hostVisible = visible
  for (const view of views) view.setVisible(visible)
}
