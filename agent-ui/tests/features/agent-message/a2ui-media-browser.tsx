import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { AgentToRendererMessageSchema } from "@a2ui/web_core/v1_0"

import "@/index.css"
import i18n from "@/i18n"
import { A2uiVisual } from "@/features/agent-message/a2ui/a2ui-visual"
import mediaResult from "../../fixtures/a2ui/media.json"

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

function messages(source?: string, tabbed = false, standalone = false) {
  const result = mediaResult.messages.map((message) => AgentToRendererMessageSchema.parse(message))
  for (const message of result) {
    if (!("createSurface" in message)) continue
    const components = message.createSurface.components!
    if (source) components.find((component) => component.id === "localImage")!.url = source
    if (standalone) message.createSurface.components = [{ ...components.find((component) => component.id === "remoteImage")!, id: "root" }]
    if (tabbed) {
      components.find((component) => component.id === "root")!.id = "mediaContent"
      components.push(
        { id: "root", component: "Tabs", tabs: [{ title: "Images and icons", child: "mediaContent" }, { title: "Details", child: "details" }] },
        { id: "details", component: "Text", text: "Switch back to verify that loaded images and previews retain their state." },
      )
    }
  }
  return result
}
const initialMessages = messages()
const wait = (ms = 20) => new Promise<void>((resolve) => setTimeout(resolve, ms))
async function until(condition: () => boolean, message: string) {
  const deadline = performance.now() + 5000
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(message)
    await wait()
  }
}
function images() { return Array.from(document.querySelectorAll<HTMLImageElement>("#dashboard-fixture .a2ui-image img")) }
function state(image: HTMLImageElement) { return image.closest(".a2ui-image")?.getAttribute("data-state") }
async function loaded() {
  await until(() => images().length === 2, "Expected two image elements")
  for (const image of images()) {
    image.scrollIntoView({ block: "center", behavior: "instant" })
    await until(() => image.naturalWidth > 0 && state(image) === "ready", `Image did not load: ${image.alt}`)
  }
}
function selectTab(index: number) {
  const tab = document.querySelectorAll<HTMLButtonElement>('#dashboard-fixture [role="tab"]')[index]
  tab.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }))
  tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
  tab.click()
}

export function Fixture() {
  const [narrow, setNarrow] = useState(query.has("narrow"))
  const [dark, setDark] = useState(query.has("dark"))
  const [current, setCurrent] = useState(initialMessages)
  const [result, setResult] = useState("Ready — canonical compiler output with synthetic image responses; no model calls.")
  const [running, setRunning] = useState(false)

  const run = async () => {
    setRunning(true)
    setResult("Running…")
    const passed: string[] = []
    const check = (condition: unknown, message: string) => {
      if (!condition) throw new Error(message)
      passed.push(`PASS ${message}`)
    }
    const show = async (source?: string, tabbed = false, standalone = false) => {
      const previous = document.querySelector("#dashboard-fixture [data-a2ui-surface]")
      flushSync(() => setCurrent(messages(source, tabbed, standalone)))
      // A2uiVisual replays messages in an effect. Waiting only for loaded images
      // can observe the previous, already-ready surface before that replay commits.
      await until(() => {
        const next = document.querySelector("#dashboard-fixture [data-a2ui-surface]")
        return !!next && next !== previous
      }, "Updated canonical surface did not commit")
    }
    try {
      await show()
      await loaded()
      const [landscape, portrait] = images()
      const path = new URL(landscape.src)
      check(path.pathname === "/api/sandbox/files/download" && path.searchParams.get("path") === "/a2ui-media-fixtures/landscape.svg", "Sandbox images use the existing download route")
      check(portrait.src === "http://127.0.0.1:5188/a2ui-media-fixtures/portrait.svg" && portrait.alt === "Illustrative portrait orientation image", "Bound HTTP image URL and alternative text render correctly")
      const landscapeBounds = landscape.getBoundingClientRect()
      check(Math.abs(landscapeBounds.width / landscapeBounds.height - landscape.naturalWidth / landscape.naturalHeight) < 0.02, "Contained images preserve their natural aspect ratio")
      const cover = portrait.closest("button")!.getBoundingClientRect()
      check(Math.abs(cover.width / cover.height - 16 / 9) < 0.02 && getComputedStyle(portrait).objectFit === "cover", "Cover images crop only inside their 16:9 frame")
      const icons = Array.from(document.querySelectorAll<SVGElement>("#dashboard-fixture .a2ui-icon"))
      check(icons.length === 4 && icons[0].getAttribute("aria-hidden") === "true" && icons[1].getAttribute("aria-label") === "Revenue is increasing", "Decorative and labeled Lucide icons have distinct accessibility semantics")
      check(icons.map((icon) => icon.getAttribute("width")).join() === "16,20,32,20", "Small, medium and large icon sizes render")
      check(getComputedStyle(icons[0]).color !== getComputedStyle(icons[3]).color, "Muted icon color follows the application theme")

      const origin = landscape.closest<HTMLButtonElement>("button")!
      check(origin.isConnected && landscape === images()[0] && !origin.disabled, "Preview targets the current loaded surface")
      origin.scrollIntoView({ block: "center", behavior: "instant" })
      origin.focus({ preventScroll: true })
      origin.click()
      await until(() => !!document.querySelector('[role="dialog"] img'), "Image preview did not open")
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
      check(dialog.querySelector<HTMLImageElement>("img")!.src === landscape.src, "Clicking a loaded image opens the existing lightbox at the same source")
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      await until(() => !document.querySelector('[role="dialog"]'), "Escape did not close the lightbox")
      check(document.activeElement === origin, "Escape restores focus to the image preview button")

      await show("sandbox:/a2ui-media-fixtures/retry.svg")
      await until(() => document.querySelector('.a2ui-image[data-state="error"]') !== null, "Missing image did not show a recoverable error")
      const failed = document.querySelector<HTMLElement>('.a2ui-image[data-state="error"]')!
      check(failed.querySelector('[role="alert"]')!.textContent === i18n.t("agentMessage.imageTools.loadFailed"), "Image failure is localized and does not replace the dashboard")
      failed.querySelector<HTMLButtonElement>("button")!.click()
      await loaded()
      check(new URL(images()[0].src).searchParams.get("retry") === "1", "Retry reloads a failed sandbox image and recovers the preview")

      await show("sandbox:/a2ui-media-fixtures/slow.svg")
      await until(() => images()[0]?.src.includes("slow.svg") === true, "Replacement source did not render")
      check(state(images()[0]) === "loading" && images()[0].closest<HTMLButtonElement>("button")!.disabled, "Changing source restores the loading skeleton and disables premature zoom")
      await loaded()
      check(state(images()[0]) === "ready", "A replacement source becomes previewable after its load event")

      flushSync(() => setNarrow(false))
      await show(undefined, false, true)
      await until(() => images().length === 1, "Standalone portrait did not render")
      const standalone = images()[0]
      standalone.scrollIntoView({ block: "center", behavior: "instant" })
      await until(() => standalone.naturalWidth > 0 && state(standalone) === "ready", "Standalone portrait did not load")
      const standaloneFrame = standalone.closest<HTMLButtonElement>("button")!.getBoundingClientRect()
      const maxHeight = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * 24
      check(Math.abs(standaloneFrame.width / standaloneFrame.height - 16 / 9) < 0.02 && standaloneFrame.height <= maxHeight + 1, "Standalone cover preserves 16:9 and its 24rem height cap in a wide container")
      check(standaloneFrame.width <= document.getElementById("dashboard-fixture")!.getBoundingClientRect().width, "Standalone cover remains within the conversation width")
      flushSync(() => setNarrow(query.has("narrow")))

      await show(undefined, true)
      await loaded()
      const retained = images()[0]
      selectTab(1)
      await until(() => retained.closest('[hidden][inert]') !== null, "Inactive media panel was not retained and hidden")
      selectTab(0)
      await until(() => retained.closest('[hidden][inert]') === null, "Media panel did not become visible again")
      check(images()[0] === retained && state(retained) === "ready", "Tabs preserve the loaded image DOM and preview state")
      await wait(350)

      const visual = document.querySelector<HTMLElement>('[data-slot="a2ui-visual"]')!
      check(visual.scrollWidth <= visual.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth, "Media stays within the conversation container")
      if (query.has("reduced-motion")) {
        check(!Array.from(document.querySelectorAll(".a2ui-tabs-panel")).some((panel) => panel.getAnimations().length), "Reduced motion leaves no running panel animations")
      }
      await show()
      await loaded()
      window.scrollTo({ top: 0, behavior: "instant" })
      setResult(`${passed.join("\n")}\nALL ${passed.length} CHECKS PASSED`)
    } catch (error) {
      setResult(`${passed.join("\n")}\nFAIL ${error instanceof Error ? error.stack : String(error)}`)
    } finally { setRunning(false) }
  }

  return <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
    <div className="mx-auto mb-6 flex max-w-3xl flex-wrap gap-3 text-sm">
      <button className="rounded-lg border px-3 py-2" onClick={() => { void run() }} disabled={running}>Run media checks</button>
      <button className="rounded-lg border px-3 py-2" onClick={() => setNarrow((value) => !value)}>{narrow ? "Use wide container" : "Use narrow container"}</button>
      <button className="rounded-lg border px-3 py-2" onClick={() => { document.documentElement.classList.toggle("dark", !dark); setDark(!dark) }}>{dark ? "Use light theme" : "Use dark theme"}</button>
      <button className="rounded-lg border px-3 py-2" onClick={() => setCurrent(messages(undefined, true))}>Show in Tabs</button>
    </div>
    <section id="dashboard-fixture" className="mx-auto w-full" style={{ maxWidth: narrow ? 380 : 768 }}>
      <A2uiVisual messages={current} />
    </section>
    <pre id="results" role="status" className="mx-auto mt-6 max-w-3xl whitespace-pre-wrap break-words rounded-xl border p-4 text-xs leading-6">{result}</pre>
  </main>
}

const root = createRoot(document.getElementById("root")!)
root.render(<StrictMode><Fixture /></StrictMode>)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
