import { StrictMode, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { AgentToRendererMessageSchema } from "@a2ui/web_core/v1_0"

import "@/index.css"
import i18n from "@/i18n"
import { A2uiVisual } from "@/features/agent-message/a2ui/a2ui-visual"
import galleryResult from "../../fixtures/a2ui/gallery.json"

const query = new URLSearchParams(location.search)
document.documentElement.classList.toggle("dark", query.has("dark"))
void i18n.changeLanguage(query.has("zh") ? "zh-CN" : "en")
if (query.has("reduced-motion")) {
  const matchMedia = window.matchMedia.bind(window)
  window.matchMedia = (media) => {
    const result = matchMedia(media)
    if (media.includes("prefers-reduced-motion")) Object.defineProperty(result, "matches", { value: true })
    return result
  }
}
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches

function messages(mode: "canonical" | "retry" | "single" | "long" = "canonical") {
  // Component properties include opaque nested values. Schema parsing alone
  // does not clone images[], so each failure/navigation scenario owns its data.
  const result = structuredClone(galleryResult.messages).map((message) => AgentToRendererMessageSchema.parse(message))
  for (const message of result) {
    if (!("createSurface" in message)) continue
    const gallery = message.createSurface.components!.find((component) => component.component === "ImageGallery")!
    const images = gallery.images as { url: unknown }[]
    if (mode === "retry") images[0].url = "sandbox:/a2ui-media-fixtures/retry.svg"
    if (mode === "single") gallery.images = images.slice(0, 1)
    if (mode === "long") gallery.images = Array.from({ length: 12 }, (_, index) => ({ ...images[index % images.length], title: `Image ${index + 1}` }))
  }
  return result
}
const initialMessages = messages()
const wait = (ms = 20) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
async function until(condition: () => boolean, message: string) {
  const deadline = performance.now() + 5000
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(message)
    await wait()
  }
}
function gallery() { return document.querySelector<HTMLElement>("#dashboard-fixture .a2ui-gallery")! }
function index() { return Number(gallery().dataset.index) }
function stage() { return gallery().querySelector<HTMLElement>(".a2ui-gallery-stage")! }
function activeSlide() { return gallery().querySelector<HTMLElement>('.a2ui-gallery-slide[data-active="true"]')! }
function activeImage() { return activeSlide().querySelector<HTMLImageElement>("img")! }
function navigation(direction: "previous" | "next") { return gallery().querySelector<HTMLButtonElement>(`button[data-direction="${direction}"]`)! }
async function loaded() {
  await until(() => !!document.querySelector('.a2ui-gallery-slide[data-active="true"] img'), "Current gallery image did not render")
  const image = activeImage()
  image.scrollIntoView({ block: "center", behavior: "instant" })
  await until(() => image.naturalWidth > 0 && image.closest(".a2ui-image")?.getAttribute("data-state") === "ready", `Current image did not load: ${image.alt}`)
}
function key(element: HTMLElement, value: string) { element.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true })) }
function selectTab(value: number) {
  const tab = document.querySelectorAll<HTMLButtonElement>('#dashboard-fixture [role="tab"]')[value]
  tab.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }))
  tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
  tab.click()
}
function pointer(type: string, x: number, y: number) {
  return new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: "mouse", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y })
}
async function drag(distance: number, during?: () => void) {
  const origin = activeImage().closest<HTMLButtonElement>("button")!
  const bounds = origin.getBoundingClientRect()
  const x = bounds.left + bounds.width / 2
  const y = bounds.top + bounds.height / 2
  origin.dispatchEvent(pointer("pointerdown", x, y))
  await frame()
  for (let step = 1; step <= 5; step += 1) {
    window.dispatchEvent(pointer("pointermove", x + distance * step / 5, y))
    await frame()
    during?.()
  }
  window.dispatchEvent(pointer("pointerup", x + distance, y))
  // Native pointer release generates a click on the origin. Reproduce that click
  // in the synthetic run to verify it cannot open or reselect the previous slide.
  origin.click()
  await wait()
}
function visibleSlides() {
  const bounds = stage().getBoundingClientRect()
  return Array.from(gallery().querySelectorAll<HTMLElement>(".a2ui-gallery-slide")).filter((slide) => {
    const style = getComputedStyle(slide)
    const rect = slide.getBoundingClientRect()
    return !slide.hidden && style.visibility !== "hidden" && Number(style.opacity) > 0.05 && rect.width > 0
      && rect.right > bounds.left && rect.left < bounds.right && rect.bottom > bounds.top && rect.top < bounds.bottom
  })
}
function visualPosition() {
  const progress = gallery().querySelector<HTMLElement>(".a2ui-gallery-progress > span")!
  return new DOMMatrixReadOnly(getComputedStyle(progress).transform).m11 * Number(gallery().dataset.count) - 1
}
function assertVisible(label: string) {
  if (!visibleSlides().length) throw new Error(`Gallery became blank ${label}; selected=${index()}, visual=${visualPosition()}`)
}
function animatedClick(direction: "previous" | "next") {
  // detail=1 follows the pointer-navigation spring; HTMLElement.click() has
  // detail=0 and intentionally follows the component's immediate keyboard path.
  navigation(direction).dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, button: 0 }))
}
function wheel(deltaX: number, deltaY = 0, ctrlKey = false) {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX, deltaY, deltaMode: WheelEvent.DOM_DELTA_PIXEL, ctrlKey })
  stage().dispatchEvent(event)
  return event.defaultPrevented
}
async function shortSidePan(cancel: boolean) {
  const origin = gallery().querySelector<HTMLButtonElement>('.a2ui-gallery-slide[data-index="1"] .a2ui-image-frame')!
  origin.focus({ preventScroll: true })
  if (document.activeElement !== origin) throw new Error("Side-pan regression could not focus its pointer target")
  const bounds = origin.getBoundingClientRect()
  const x = bounds.left + bounds.width / 2
  const y = bounds.top + bounds.height / 2
  origin.dispatchEvent(pointer("pointerdown", x, y))
  await frame()
  window.dispatchEvent(pointer("pointermove", x + 12, y))
  await wait(80)
  // A stationary sample keeps this below the flick threshold; the gesture is
  // intentionally too short to choose a neighboring image.
  window.dispatchEvent(pointer("pointermove", x + 12, y))
  await wait(80)
  if (cancel) origin.dispatchEvent(pointer("pointercancel", x + 12, y))
  else {
    window.dispatchEvent(pointer("pointerup", x + 12, y))
    origin.click()
  }
  await settledVisible(0, cancel ? "after cancelling a side-image pan" : "after a short side-image pan")
}
async function settledVisible(target: number, label: string) {
  const deadline = performance.now() + 5000
  let stableFrames = 0
  const observed = new Set<number>()
  while (stableFrames < 3) {
    await frame()
    assertVisible(label)
    visibleSlides().forEach((slide) => observed.add(Number(slide.dataset.index)))
    stableFrames = index() === target && Math.abs(visualPosition() - target) < 0.02 ? stableFrames + 1 : 0
    if (performance.now() > deadline) throw new Error(`Gallery did not settle at ${target} ${label}`)
  }
  return observed
}
function pressImage(button: HTMLButtonElement) {
  const bounds = button.getBoundingClientRect()
  const x = bounds.left + bounds.width / 2
  const y = bounds.top + bounds.height / 2
  button.focus({ preventScroll: true })
  button.dispatchEvent(pointer("pointerdown", x, y))
  button.dispatchEvent(pointer("pointerup", x, y))
  button.click()
}

export function Fixture() {
  const [narrow, setNarrow] = useState(query.has("narrow"))
  const [dark, setDark] = useState(query.has("dark"))
  const [current, setCurrent] = useState(initialMessages)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState("Ready — canonical ImageGallery fixture. Drag the center image horizontally; click it to inspect the original image.")
  const actionCount = useRef(0)

  const run = async () => {
    setRunning(true)
    setResult("Running…")
    actionCount.current = 0
    const passed: string[] = []
    const check = (condition: unknown, message: string) => {
      if (!condition) throw new Error(message)
      passed.push(`PASS ${message}`)
    }
    const show = async (mode: Parameters<typeof messages>[0] = "canonical") => {
      const previous = document.querySelector("#dashboard-fixture [data-a2ui-surface]")
      flushSync(() => setCurrent(messages(mode)))
      await until(() => {
        const next = document.querySelector("#dashboard-fixture [data-a2ui-surface]")
        return !!next && next !== previous
      }, "Updated gallery surface did not commit")
    }
    const navigate = async (target: number) => {
      key(gallery(), target === 0 ? "Home" : "End")
      await until(() => index() === target, `Keyboard navigation did not reach ${target}`)
      await loaded()
    }
    try {
      await show()
      await loaded()
      await wait(350)
      check(gallery().dataset.count === "3" && index() === 0, "Canonical ImageGallery starts on the first of three images")
      check(gallery().textContent!.includes("Illustrative image gallery"), "The bound gallery title renders")
      check(navigation("previous").disabled && !navigation("next").disabled, "Previous navigation is disabled at the first image")
      const side = gallery().querySelector<HTMLElement>('.a2ui-gallery-slide[data-index="1"]')!
      const sideTransform = new DOMMatrixReadOnly(getComputedStyle(side).transform)
      check(getComputedStyle(stage()).perspective !== "none" && Math.abs(sideTransform.m13) > 0.01, "The stage uses perspective and rotates neighboring images in 3D")
      const sideBounds = side.getBoundingClientRect()
      const stageBounds = stage().getBoundingClientRect()
      check(sideBounds.right > stageBounds.left && sideBounds.left < stageBounds.right, "A neighboring image remains visible in the stage")
      check(gallery().querySelectorAll('.a2ui-gallery-slide[data-active="true"]').length === 1 && side.getAttribute("aria-hidden") === "true", "Exactly one slide is active and inactive slides are hidden from assistive technology")
      check(gallery().querySelector(".a2ui-gallery-caption")!.textContent!.includes("Landscape") && /1.*3/.test(gallery().querySelector(".a2ui-gallery-count")!.textContent!), "Current title and image count are shown below the stage")
      const progress = gallery().querySelector<HTMLElement>(".a2ui-gallery-progress")!
      const progressRatio = progress.firstElementChild!.getBoundingClientRect().width / progress.getBoundingClientRect().width
      check(Math.abs(progressRatio - 1 / 3) < 0.03, "Progress reflects the selected image")

      navigation("next").click()
      await until(() => index() === 1, "Next did not select the portrait")
      await loaded()
      check(activeImage().src === "http://127.0.0.1:5188/a2ui-media-fixtures/portrait.svg" && activeImage().alt === "Illustrative portrait orientation image", "Nested URL and description bindings resolve through the official renderer")
      check(gallery().querySelector(".a2ui-gallery-caption")!.textContent!.includes("Portrait"), "The nested title binding follows selection")
      await navigate(2)
      check(navigation("next").disabled && !navigation("previous").disabled, "Next navigation is disabled at the final image")
      await navigate(0)

      const retainedGallery = gallery()
      const retainedImage = activeImage()
      navigation("next").click()
      await until(() => index() === 1, "Selection before Tabs did not change")
      await loaded()
      const selectedImage = activeImage()
      selectTab(1)
      await until(() => retainedGallery.closest('[hidden][inert]') !== null, "Gallery tab did not become inactive")
      selectTab(0)
      await until(() => retainedGallery.closest('[hidden][inert]') === null, "Gallery tab did not return")
      check(gallery() === retainedGallery && activeImage() === selectedImage && index() === 1 && retainedImage.isConnected, "Tabs preserve selected index and mounted image state")
      await wait(350)

      await navigate(0)
      await drag(-150)
      await until(() => index() === 1, "Dragging left did not advance the image")
      check(!document.querySelector('[role="dialog"]'), "The click produced by a drag cannot open the lightbox")
      await loaded()
      await drag(150)
      await until(() => index() === 0, "Dragging right did not return to the previous image")
      check(!document.querySelector('[role="dialog"]'), "Dragging right preserves click suppression and direction")
      await loaded()

      const origin = activeImage().closest<HTMLButtonElement>("button")!
      const source = activeImage().src
      pressImage(origin)
      await until(() => !!document.querySelector('[role="dialog"] img'), "A fresh click after drag did not open preview")
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
      check(dialog.querySelector<HTMLImageElement>("img")!.src === source, "Lightbox receives the original full image source")
      key(dialog, "Escape")
      await until(() => !document.querySelector('[role="dialog"]'), "Escape did not close image preview")
      await until(() => document.activeElement === origin, "Closing preview did not restore focus to its image")
      check(document.activeElement === origin, "Closing preview returns focus to the selected image")

      navigation("next").click()
      navigation("next").click()
      navigation("previous").click()
      navigation("next").click()
      await until(() => index() === 2, "Rapid navigation did not settle on the final selection")
      check(gallery().querySelectorAll('.a2ui-gallery-slide[data-active="true"]').length === 1, "Rapid navigation leaves one selected image")
      await loaded()
      if (reducedMotion) {
        await wait(30)
        const transform = getComputedStyle(activeSlide()).transform
        await wait(80)
        check(getComputedStyle(activeSlide()).transform === transform, "Reduced motion settles selection immediately")
      }

      await show("long")
      await loaded()
      const longImages = Array.from(gallery().querySelectorAll<HTMLImageElement>(".a2ui-gallery-slide img"))
      longImages.forEach((image) => { image.loading = "eager" })
      await until(() => longImages.every((image) => image.naturalWidth > 0 && image.closest(".a2ui-image")?.getAttribute("data-state") === "ready"), "The twelve-image motion fixture did not finish loading")
      const stride = activeSlide().offsetWidth * 0.72
      let dragSamples = 0
      await drag(-stride * 3.5, () => {
        dragSamples += 1
        assertVisible("during a drag spanning more than three image strides")
        if (visualPosition() > 1.02) throw new Error("Long drag moved beyond the adjacent image before release")
      })
      await settledVisible(1, "after the long drag")
      check(dragSamples === 5 && index() === 1 && !document.querySelector('[role="dialog"]'), "A drag exceeding three strides keeps visible content throughout and advances only one image")

      await navigate(0)
      const forwardObserved = new Set<number>()
      for (let step = 0; step < 8; step += 1) {
        animatedClick("next")
        await frame()
        assertVisible("during eight rapid animated next clicks")
        visibleSlides().forEach((slide) => forwardObserved.add(Number(slide.dataset.index)))
      }
      if (!reducedMotion) check(visualPosition() < 7.9, "Rapid pointer navigation interrupts an in-flight spring")
      for (const observed of await settledVisible(8, "while completing rapid forward navigation")) forwardObserved.add(observed)
      check(index() === 8 && (reducedMotion || Array.from(forwardObserved).some((item) => item >= 2 && item <= 6)), "Rapid next navigation keeps intermediate images visible and settles on image nine")

      for (const direction of ["previous", "previous", "next", "previous", "previous"] as const) {
        animatedClick(direction)
        await frame()
        assertVisible("during rapid direction reversal")
      }
      await settledVisible(5, "after rapid direction reversal")
      check(index() === 5 && gallery().querySelectorAll('.a2ui-gallery-slide[data-active="true"]').length === 1, "Rapid reversals keep the gallery visible and settle on the final requested image")

      await navigate(0)
      check(!wheel(0, 120) && !wheel(120, 0, true), "Vertical scrolling and trackpad pinch zoom remain unconsumed")
      await wait(220)
      check(index() === 0, "Vertical and pinch gestures leave gallery selection unchanged")
      for (let step = 0; step < 20; step += 1) {
        if (!wheel(60)) throw new Error("A horizontal trackpad event was not consumed")
        await wait(12)
        assertVisible("during a continuous trackpad gesture with momentum")
        if (visualPosition() > 1.02) throw new Error("Trackpad momentum advanced beyond the adjacent image")
      }
      await settledVisible(1, "after trackpad gesture idle")
      check(index() === 1, "Horizontal trackpad scrolling updates continuously and one momentum burst advances only one image")
      check(wheel(-stride), "Reverse horizontal trackpad input is consumed")
      await settledVisible(0, "after a reverse trackpad gesture")
      check(index() === 0, "Reverse trackpad scrolling selects the previous image")
      check(wheel(-stride), "Outward trackpad input at the first image remains contained")
      await wait(220)
      await settledVisible(0, "at the first-image trackpad boundary")
      await navigate(11)
      check(wheel(stride), "Outward trackpad input at the final image remains contained")
      await wait(220)
      await settledVisible(11, "at the final-image trackpad boundary")
      check(index() === 11, "Trackpad navigation clamps at both gallery boundaries")

      // Synthetic macOS-style streams: a finger ramp, then momentum decaying every frame.
      const fingers = [3, 8, 14, 20, 24, 24, 22, 18, 14]
      const momentum = (events: number) => Array.from({ length: events }, (_, step) => 16 * 0.9 ** step)
      const swipe = async (deltas: number[], onFrame?: () => void) => {
        for (const delta of deltas) {
          if (!wheel(delta)) throw new Error("A trackpad swipe event was not consumed")
          await frame()
          onFrame?.()
        }
      }
      await navigate(0)
      check(wheel(0.3), "The first horizontal event of a swipe is consumed even when it is tiny")
      await wait(450)
      await settledVisible(0, "after a tiny horizontal event")
      await swipe([...fingers, ...momentum(30)])
      await settledVisible(1, "after one swipe with long momentum")
      check(index() === 1, "Momentum after a released swipe never advances a second image")
      await swipe([...fingers, ...momentum(14), ...fingers, ...momentum(14)])
      await settledVisible(3, "after two consecutive swipes")
      check(index() === 3, "A swipe that starts while the previous momentum is decaying advances its own image")
      // A slow ramp inside still-decaying momentum is classified as momentum; start after it ends.
      await wait(400)
      const resumed: number[] = []
      await swipe([6, 8, 10, 12, 14, 16, 18])
      await wait(250)
      resumed.push(index())
      await swipe([10, 12, 14, 16, 18, 20], () => resumed.push(index()))
      await wait(450)
      await settledVisible(index(), "after a paused trackpad swipe")
      check(resumed[0] === 4 && resumed.every((value) => value >= 4), "Resuming a paused swipe never reselects the image it left")

      await navigate(0)
      await shortSidePan(false)
      check(document.activeElement === gallery() && !document.activeElement.closest('[aria-hidden="true"]'), "A short side-image pan restores focus outside the inactive slide even when selection does not change")
      await shortSidePan(true)
      check(document.activeElement === gallery() && !document.activeElement.closest('[aria-hidden="true"]'), "Cancelling a side-image pan restores focus to the accessible gallery")

      await show("retry")
      await until(() => !!activeSlide()?.querySelector('[role="alert"]'), "Unavailable gallery image did not show an error")
      check(activeSlide().querySelector('[role="alert"]')!.textContent === i18n.t("agentMessage.imageTools.loadFailed"), "Gallery errors use the shared localized image feedback")
      activeSlide().querySelector<HTMLButtonElement>("button")!.click()
      await loaded()
      check(new URL(activeImage().src).searchParams.get("retry") === "1", "Retry recovers the current image without changing selection")

      await show("single")
      await loaded()
      check(gallery().dataset.count === "1" && !gallery().querySelector("[data-direction]"), "Single-image galleries retain preview without unnecessary navigation")
      check(!wheel(120), "Single-image galleries leave trackpad scrolling unconsumed")
      await show()
      await loaded()
      const visual = document.querySelector<HTMLElement>('[data-slot="a2ui-visual"]')!
      check(visual.scrollWidth <= visual.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth, "The gallery stays inside the conversation width without horizontal page overflow")
      check(!narrow || gallery().getBoundingClientRect().width <= 390, "Narrow mode stays within the 390px conversation container")
      check(document.documentElement.classList.contains("dark") === dark && getComputedStyle(gallery()).color === getComputedStyle(document.body).color, "Gallery text and surface use the application theme")
      check(actionCount.current === 0, "Navigation, dragging, Tabs and preview never dispatch agent actions")
      window.scrollTo({ top: 0, behavior: "instant" })
      setResult(`${passed.join("\n")}\nALL ${passed.length} CHECKS PASSED`)
    } catch (error) {
      setResult(`${passed.join("\n")}\nFAIL ${error instanceof Error ? error.stack : String(error)}`)
    } finally { setRunning(false) }
  }

  return <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
    <div className="mx-auto mb-6 flex max-w-3xl flex-wrap gap-3 text-sm">
      <button className="rounded-lg border px-3 py-2" disabled={running} onClick={() => { void run() }}>Run gallery checks</button>
      <button className="rounded-lg border px-3 py-2" onClick={() => setNarrow((value) => !value)}>{narrow ? "Use wide container" : "Use 390px container"}</button>
      <button className="rounded-lg border px-3 py-2" onClick={() => { document.documentElement.classList.toggle("dark", !dark); setDark(!dark) }}>{dark ? "Use light theme" : "Use dark theme"}</button>
    </div>
    <section id="dashboard-fixture" className="mx-auto w-full" style={{ maxWidth: narrow ? 390 : 768 }}>
      <A2uiVisual messages={current} onAction={() => { actionCount.current += 1 }} />
    </section>
    <pre id="results" role="status" className="mx-auto mt-6 max-w-3xl whitespace-pre-wrap break-words rounded-xl border p-4 text-xs leading-6">{result}</pre>
  </main>
}

const root = createRoot(document.getElementById("root")!)
root.render(<StrictMode><Fixture /></StrictMode>)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
