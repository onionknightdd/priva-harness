import { createInstance } from "i18next"
import { MotionConfig } from "motion/react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { I18nextProvider, initReactI18next } from "react-i18next"

import { LiveTextScope, StableText } from "../../../src/components/motion/stable-text"
import type { AgentThreadMessage, StreamBlock } from "../../../src/features/agent-message/agent-message-data"
import { WorkingStatusLine } from "../../../src/features/agent-message/components/working-status-line"
import { formatProcessStatusText, processStatusPieces } from "../../../src/features/agent-message/process-status"
import { en } from "../../../src/i18n/locales/en"
import { zhCN } from "../../../src/i18n/locales/zh-CN"
import "../../../src/index.css"

const query = new URLSearchParams(location.search)
const reducedMotion = query.has("reduced-motion")
document.documentElement.classList.toggle("dark", query.has("dark"))
if (reducedMotion) {
  const matchMedia = window.matchMedia.bind(window)
  window.matchMedia = (media) => media.includes("prefers-reduced-motion")
    ? Object.assign(new EventTarget(), { matches: true, media, onchange: null, addListener() {}, removeListener() {} }) as MediaQueryList
    : matchMedia(media)
}
const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: query.has("zh") ? "zh-CN" : "en",
  resources: { en: { translation: en }, "zh-CN": { translation: zhCN } },
  interpolation: { escapeValue: false },
})
const t = i18n.t.bind(i18n)
const literalValues = query.has("zh") ? ["个文件", "个目录"] : [" file", " files"]
const host = document.querySelector<HTMLDivElement>("#fixtures")!
const results = document.querySelector<HTMLPreElement>("#results")!
const root = createRoot(host)
let narrow = query.has("narrow")
let literal = literalValues[0]!
let epoch = 0

function tool(id: string, name: string, complete = false): StreamBlock {
  return { type: "tool_use", id, blockId: id, index: Number(id.replace(/\D/g, "")) || 0, name,
    tool: { id, name, status: complete ? "completed" : "running" } }
}
const states: StreamBlock[][] = [
  [tool("read1", "read"), tool("read2", "read")],
  [tool("read1", "read"), tool("read2", "read"), tool("read3", "read")],
  [tool("read1", "read", true), tool("read2", "read", true), tool("read3", "read", true)],
  [tool("read1", "read", true), tool("read2", "read"), tool("edit3", "edit"), tool("bash4", "bash", true)],
  [tool("read1", "read", true), tool("read2", "read"), tool("edit3", "edit"), tool("bash4", "bash", true), tool("write5", "write")],
  [tool("read1", "read", true), tool("read2", "read", true), tool("edit3", "edit", true), tool("bash4", "bash", true), tool("write5", "write", true)],
]
let stateIndex = 0
let message: AgentThreadMessage = newMessage()
function newMessage(): AgentThreadMessage {
  return { id: "status-line-fixture", role: "assistant", status: "streaming", content: "", createdAt: new Date(Date.now() - 4_000).toISOString(), blocks: states[0] }
}

export function Fixtures() {
  return <I18nextProvider i18n={i18n}>
    <MotionConfig reducedMotion={reducedMotion ? "always" : "user"}>
      <div className="space-y-5">
        <section className="space-y-2">
          <h2 className="text-sm text-muted-foreground">WorkingStatusLine · actual component</h2>
          <div id="working-host" className="rounded border p-2" style={{ width: narrow ? 240 : "100%", maxWidth: "100%" }}>
            <WorkingStatusLine message={message} />
          </div>
        </section>
        <section className="space-y-2">
          <h2 className="text-sm text-muted-foreground">Isolated same-ID literal · first change and reversal</h2>
          <div id="literal-host" className="text-ui text-muted-foreground">
            <LiveTextScope><StableText pieces={[{ id: "literal", text: literal }]} shimmer /></LiveTextScope>
          </div>
        </section>
      </div>
    </MotionConfig>
  </I18nextProvider>
}
function render() { flushSync(() => root.render(<Fixtures key={epoch} />)) }
function updateState(index: number) {
  stateIndex = index
  message = { ...message, blocks: states[index] }
  render()
}
function workingHost() { return host.querySelector<HTMLElement>("#working-host")! }
function literalHost() { return host.querySelector<HTMLElement>("#literal-host")! }
function visualLeaves(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("span")].filter((node) =>
    node.childElementCount === 0 && Boolean(node.textContent?.trim()) && !node.closest(".sr-only"))
}

// Multiply composited opacity, then intersect every vertical clipping surface.
// ActionSwap's inset(0 -999px) clips vertically while allowing wide old labels.
function visibility(node: HTMLElement): number {
  const box = node.getBoundingClientRect()
  if (!box.width || !box.height) return 0
  let top = box.top
  let bottom = box.bottom
  let opacity = 1
  for (let ancestor: HTMLElement | null = node; ancestor && ancestor !== host.parentElement; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor)
    if (style.visibility === "hidden" || style.display === "none") return 0
    opacity *= Number(style.opacity)
    if (style.clipPath !== "none" || ["hidden", "clip"].includes(style.overflowY)) {
      const clip = ancestor.getBoundingClientRect()
      top = Math.max(top, clip.top)
      bottom = Math.min(bottom, clip.bottom)
    }
  }
  return opacity * Math.max(0, bottom - top) / box.height
}
function clockNode(): HTMLElement | undefined {
  const prefix = t("agentMessage.runningFor", { time: "" }).trim()
  return visualLeaves(workingHost()).find((node) => node.textContent?.startsWith(prefix))
}
function visibleText(container: HTMLElement): string {
  return visualLeaves(container).filter((node) => visibility(node) > 0.01).map((node) => node.textContent).join("")
}
function accessibleText(container: HTMLElement): string {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const text: string[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (!node.parentElement?.closest('[aria-hidden="true"]')) text.push(node.textContent ?? "")
  }
  return text.join("")
}
function literalNode(container: HTMLElement, text: string): HTMLElement | undefined {
  return [...container.querySelectorAll<HTMLElement>("span")].find((node) =>
    node.textContent === text && !node.closest(".sr-only") && visibility(node) > 0.5)
}
const nextFrame = () => new Promise<number>(requestAnimationFrame)
render()

async function runChecks() {
  const passed: string[] = []
  const samples: string[] = []
  const check = (name: string, condition: boolean) => {
    if (!condition) throw new Error(name)
    passed.push(name)
  }
  try {
    epoch += 1
    message = newMessage()
    literal = literalValues[0]!
    stateIndex = 0
    render()
    await nextFrame()
    await nextFrame()
    const line = host.querySelector('[data-slot="working-status-line"]')!
    const clock = clockNode()!
    check("initial status and clock are visible", Boolean(line && clock && visibility(clock) > 0.9))

    async function sample(name: string, mutate: () => void, container = workingHost(), duration = 850, scheduled: { at: number; update: () => void }[] = []) {
      results.textContent = `Running: ${name}\n${samples.join("\n")}`
      const started = performance.now()
      let min = 1
      let frames = 0
      let next = 0
      mutate()
      do {
        const elapsed = performance.now() - started
        while (next < scheduled.length && elapsed >= scheduled[next]!.at) scheduled[next++]!.update()
        const letters = visualLeaves(container).filter((node) => node !== clock && /[\p{L}\p{N}]/u.test(node.textContent ?? ""))
        const score = Math.max(0, ...letters.map(visibility))
        min = Math.min(min, score)
        frames += 1
        if (line !== host.querySelector('[data-slot="working-status-line"]') || clock !== clockNode()) {
          throw new Error(`${name}: status/clock changed DOM identity`)
        }
        await nextFrame()
      } while (performance.now() - started < duration)
      samples.push(`${name}: ${frames} frames, worst visible glyph ${(min * 100).toFixed(1)}%`)
      check(`${name}: status/clock retain DOM identity`, true)
      check(`${name}: no sampled blank text frame (${min.toFixed(4)})`, min > 0.01 && frames >= 3)
    }

    const initialPieces = processStatusPieces(message, true, t, "")
    const before = literalNode(workingHost(), initialPieces.find((piece) => piece.id === "read:running:before")!.text)
    const after = literalNode(workingHost(), initialPieces.find((piece) => piece.id === "read:running:after")!.text)
    check("surrounding words can be located", Boolean(before && after))
    await sample("count 2 → 3", () => updateState(1))
    check("count change preserves surrounding word nodes", Boolean(before?.isConnected && after?.isConnected))
    await sample("running → done", () => updateState(2))
    await sample("mixed running/done and tool kinds", () => updateState(3))
    await sample("new tool category", () => updateState(4))
    await sample("literal first change", () => { literal = literalValues[1]!; render() }, literalHost())
    await sample("literal reversal", () => { literal = literalValues[0]!; render() }, literalHost())
    await sample("rapid updates and returning keys", () => updateState(5), workingHost(), 1_200, [
      { at: 60, update: () => updateState(3) },
      { at: 120, update: () => updateState(4) },
      { at: 180, update: () => updateState(5) },
    ])
    narrow = true
    await sample("240px container", () => updateState(3))
    await sample("narrow simultaneous completion", () => updateState(5), workingHost(), 1_200)
    const expected = formatProcessStatusText(message, true, t, clock.textContent ?? "")
    check("exiting tool text is removed after settling", visibleText(workingHost()).replace(/\s/g, "") === expected.replace(/\s/g, ""))
    check("accessible status contains exactly the current sentence", accessibleText(workingHost()) === expected)
    check("accessible literal contains exactly its current value", accessibleText(literalHost()) === literal)
    check("narrow container does not overflow", workingHost().scrollWidth <= workingHost().clientWidth + 1)
    if (reducedMotion) {
      updateState(2)
      const immediate = formatProcessStatusText(message, true, t, clock.textContent ?? "")
      check("reduced motion paints the current text immediately", visibleText(workingHost()).replace(/\s/g, "") === immediate.replace(/\s/g, ""))
    }
    results.textContent = `PASS (${passed.length} assertions; ${reducedMotion ? "reduced" : "normal"} motion)\n${samples.join("\n")}\nDOM identity, unchanged words, exit cleanup, current accessible text and narrow layout passed.`
  } catch (error) {
    results.textContent = `FAIL after ${passed.length} assertions\n${samples.join("\n")}\n${error instanceof Error ? error.stack : String(error)}`
  }
}

document.querySelector<HTMLButtonElement>("#run")!.addEventListener("click", async () => {
  const controls = [...document.querySelectorAll<HTMLButtonElement>("button")]
  controls.forEach((button) => { button.disabled = true })
  try { await runChecks() } finally { controls.forEach((button) => { button.disabled = false }) }
})
document.querySelector<HTMLButtonElement>("#step")!.addEventListener("click", () => updateState((stateIndex + 1) % states.length))
document.querySelector<HTMLButtonElement>("#width")!.addEventListener("click", () => { narrow = !narrow; render() })
