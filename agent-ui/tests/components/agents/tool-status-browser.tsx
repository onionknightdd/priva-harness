import { StrictMode, useEffect, useState } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { MotionConfig } from "motion/react"
import { FileDiff } from "../../../src/components/agents/file-diff"
import { FileRead } from "../../../src/components/agents/file-read"
import { ToolResult } from "../../../src/components/agents/tool-result"
import { SidebarProvider } from "../../../src/components/ui/sidebar"
import { TooltipProvider } from "../../../src/components/ui/tooltip"
import { ToolItem } from "../../../src/features/agent-message/components/assistant-process"
import type { StreamBlock } from "../../../src/features/agent-message/agent-message-data"
import { ChatSessionProvider, useActiveSession, useChatSessionActions } from "../../../src/features/chat-session"
import { FilePathLink } from "../../../src/features/files/file-path-link"
import { AgentPreferencesProvider } from "../../../src/features/settings/agent-preferences-context"
import { HarnessProvider } from "../../../src/features/sidebar/header/harness-context"
import { WorkspaceFilesProvider } from "../../../src/features/workspace/workspace-files-context"
import { WorkspaceWhiteboardProvider } from "../../../src/features/workspace/workspace-whiteboard-context"
import i18n from "../../../src/i18n"
import "../../../src/index.css"

const query = new URLSearchParams(location.search)
const reduced = query.has("reduced-motion")
document.documentElement.classList.toggle("dark", query.has("dark"))
if (reduced) {
  const matchMedia = window.matchMedia.bind(window)
  window.matchMedia = media => media.includes("prefers-reduced-motion")
    ? Object.assign(new EventTarget(), { matches: true, media, onchange: null, addListener() {}, removeListener() {} }) as MediaQueryList
    : matchMedia(media)
}
await i18n.changeLanguage(query.has("zh") ? "zh-CN" : "en")

const unexpected: string[] = []
// Real providers and components; no request is forwarded to a user's Runner.
window.fetch = async (input, init) => {
  const path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname
  if (path === "/api/sandbox/agent/profile") return Response.json({ queue_behavior: "follow-up" })
  if (path === "/api/sandbox/credentials/profiles") return Response.json({ default_profile_id: null, profiles: [] })
  if (path === "/api/sandbox/agent/sessions/running") return Response.json({ running: [], warm: [] })
  if (path === "/api/sandbox/agent/sessions") return Response.json({ active_cwd: "/fixture", groups: [] })
  if (path === "/api/sandbox/agent/sessions/tool-status-fixture/thread") return Response.json({ run_mode: "agent", messages: [] })
  if (path.endsWith("/context-usage")) return Response.json(null)
  if (path === "/api/sandbox/files/exists") {
    const { paths } = JSON.parse(String(init?.body)) as { paths: string[] }
    return Response.json({ exists: Object.fromEntries(paths.map(file => [file, true])) })
  }
  unexpected.push(path)
  throw new Error(`Unexpected fixture request: ${path}`)
}

type State = "running" | "success" | "error"
const longName = `${"long-file-label-".repeat(12)}.ts`
const filePath = `/fixture/${longName}`
const lines = [{ id: "removed", type: "removed" as const, content: "const before = true" }, { id: "added", type: "added" as const, content: "const after = true" }]
const cases = [
  { id: "bash", name: "Bash", input: { command: `printf '${"long-command-".repeat(20)}'` } },
  { id: "read", name: "Read", input: { file_path: filePath } },
  { id: "write", name: "Write", input: { file_path: filePath, content: "const after = true" } },
  { id: "edit", name: "Edit", input: { file_path: filePath, old_string: "const before = true", new_string: "const after = true" } },
  { id: "generic", name: "custom_fixture_tool", input: { query: "fixture" } },
  { id: "mcp", name: "mcp__fixture__lookup", input: { query: "fixture" } },
  { id: "codemode", name: "codemode", input: { code: 'return "fixture"' } },
  { id: "skill", name: "Skill", input: { skill: "fixture-skill" } },
  { id: "canvas", name: "canvas", input: { path: "/fixture/architecture.html" } },
  { id: "whiteboard", name: "whiteboard_write", input: { path: "architecture.board.json" } },
]
function blockFor(item: typeof cases[number], state: State): Extract<StreamBlock, { type: "tool_use" }> {
  const output = item.id === "canvas" ? JSON.stringify({ path: "/fixture/architecture.html" })
    : item.id === "whiteboard" ? JSON.stringify({ path: "/fixture/.whiteboard/tool-status-fixture/architecture.board.json" }) : "const after = true"
  return { type: "tool_use", blockId: item.id, id: item.id, name: item.name, index: 0, input: item.input,
    tool: { id: item.id, name: item.name, input: item.input, status: state === "running" ? "running" : "completed",
      ok: state === "running" ? undefined : state === "success", output: state === "running" ? undefined : state === "error" ? "Fixture tool failed" : output } }
}
let changeState = (_state: State) => {}
export function ToolStatusFixture() {
  const [state, setState] = useState<State>("running")
  const { openSession } = useChatSessionActions()
  const { runSessionId } = useActiveSession()
  changeState = next => flushSync(() => setState(next))
  useEffect(() => {
    const frame = requestAnimationFrame(() => openSession({ sessionId: "tool-status-fixture", summary: "Isolated tool status checks", firstPrompt: null, customTitle: null, cwd: "/fixture", lastModified: 0, tag: null, tags: [], tagColors: {}, pinned: false, archived: false, runMode: "agent" }))
    return () => cancelAnimationFrame(frame)
  }, [openSession])
  const fileStatus = state === "running" ? "streaming" : state === "success" ? "complete" : "error"
  const file = <FilePathLink path={filePath} label={longName} marquee variant="code" />
  return <main className="mx-auto max-w-3xl space-y-4 p-4" data-ready={runSessionId === "tool-status-fixture"} data-state={state}>
    <section data-case="direct-tool"><ToolResult tool="ToolResult" title="A tool title with metadata" meta="1.4s" status={state}>Result body</ToolResult></section>
    <section data-case="sidebar-tool" className="bg-sidebar p-2"><ToolResult tool="ToolResult" title="Sidebar surface" meta="2.5s" status={state}>Result body</ToolResult></section>
    <section data-case="direct-read"><FileRead tool="FileRead" file={file} status={fileStatus} view={{ kind: "text", content: "const after = true", startLine: 1 }} /></section>
    <section data-case="direct-diff"><FileDiff tool="FileDiff" file={file} status={fileStatus} lines={lines} /></section>
    {cases.map(item => <section key={item.id} data-case={item.id}><ToolItem block={blockFor(item, state)} /></section>)}
  </main>
}
createRoot(document.querySelector("#root")!).render(<StrictMode><MotionConfig reducedMotion={reduced ? "always" : "never"}><TooltipProvider>
  <AgentPreferencesProvider><HarnessProvider><ChatSessionProvider>
    <SidebarProvider className="block min-h-0" defaultOpen={false} stateCookieName={false} widthCookieName={false} keyboardShortcut={false}>
      <WorkspaceFilesProvider><WorkspaceWhiteboardProvider><ToolStatusFixture /></WorkspaceWhiteboardProvider></WorkspaceFilesProvider>
    </SidebarProvider>
  </ChatSessionProvider></HarnessProvider></AgentPreferencesProvider>
</TooltipProvider></MotionConfig></StrictMode>)

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
async function until(condition: () => boolean, message: string) {
  const deadline = performance.now() + 5000
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(message)
    await nextFrame()
  }
}
const rows = () => [...document.querySelectorAll<HTMLElement>("[data-case]")]
const header = (row: Element) => row.querySelector<HTMLElement>("[data-tool-status]")!
const normalIconPaints = new Map<string, string>()
function originalIconPaints(row: HTMLElement) {
  return [...header(row).querySelectorAll('svg, [data-slot="mcp-tool-icon"]')]
    .filter(element => !element.closest('[data-slot="tool-error-indicator"]') && !element.classList.contains("lucide-loader-circle"))
    .map(element => {
      const style = getComputedStyle(element)
      return { icon: element.getAttribute("data-slot") ?? [...element.classList].find(name => name.startsWith("lucide-")) ?? "svg", color: style.color, stroke: style.stroke, fill: style.fill, background: style.backgroundColor }
    })
}
function assertOriginalIconColors() {
  for (const row of rows()) {
    const actual = JSON.stringify(originalIconPaints(row))
    if (actual !== normalIconPaints.get(row.dataset.case!)) throw new Error(`Existing tool/disclosure icon changed color in ${row.dataset.case}: ${actual}; expected ${normalIconPaints.get(row.dataset.case!)}`)
  }
}
function textElements(root: Element) {
  const found = new Set<HTMLElement>()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement
    if (!parent || !node.textContent?.trim() || parent.closest(".sr-only, svg")) continue
    const rect = parent.getBoundingClientRect()
    if (rect.width > 1 && rect.height > 1 && getComputedStyle(parent).visibility === "visible") found.add(parent)
  }
  return [...found]
}
const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!
function rgba(color: string) {
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
  const pixel = context.getImageData(0, 0, 1, 1).data
  return [pixel[0], pixel[1], pixel[2], pixel[3] / 255]
}
const blend = (foreground: number[], background: number[]) => background.slice(0, 3).map((value, index) => foreground[index] * foreground[3] + value * (1 - foreground[3]))
function background(element: Element) {
  const ancestors: Element[] = []
  for (let current: Element | null = element; current; current = current.parentElement) ancestors.unshift(current)
  return ancestors.reduce((color, ancestor) => blend(rgba(getComputedStyle(ancestor).backgroundColor), color), [255, 255, 255])
}
function luminance(color: number[]) {
  const [r, g, b] = color.slice(0, 3).map(value => value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function errorColorSamples() {
  return rows().flatMap(row => [...textElements(header(row)), ...header(row).querySelectorAll<SVGElement>('[data-slot="tool-error-indicator"] svg')].map(element => {
    const color = rgba(getComputedStyle(element).color)
    for (let current: Element | null = element; current; current = current.parentElement) color[3] *= Number(getComputedStyle(current).opacity)
    const surface = background(element)
    const ink = blend(color, surface)
    const a = luminance(ink), b = luminance(surface)
    return { row: row.dataset.case!, text: element instanceof SVGElement ? "error indicator" : element.textContent?.slice(0, 45), color, background: surface, contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
  }))
}
function assertErrorColors() {
  const samples = errorColorSamples()
  for (const sample of samples) {
    const expected = rgba(getComputedStyle(textElements(header(document.querySelector(`[data-case="${sample.row}"]`)!))[0]).color)
    if (sample.color.slice(0, 3).some((value, index) => Math.abs(value - expected[index]) > 1) || sample.color[0] < sample.color[1] * 1.25 || sample.color[0] < sample.color[2] * 1.05) throw new Error(`Failure text is not uniformly red: ${JSON.stringify(sample)}`)
    if (sample.contrast < 4.5) throw new Error(`Failure text contrast below 4.5: ${JSON.stringify(sample)}`)
  }
  if (!samples.length) throw new Error("No visible failure text was sampled")
  assertOriginalIconColors()
  return samples.reduce((minimum, sample) => sample.contrast < minimum.contrast ? sample : minimum)
}
async function errorIndicatorPixels() {
  const source = document.querySelector<SVGSVGElement>('[data-case="direct-tool"] [data-slot="tool-error-indicator"] svg.lucide-circle-x-filled')
  if (!source) throw new Error("The actual filled failure indicator is missing")
  const svg = source.cloneNode(true) as SVGSVGElement
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg")
  svg.setAttribute("width", "240")
  svg.setAttribute("height", "240")
  svg.style.color = getComputedStyle(source).color
  const rendered = new Image()
  rendered.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`
  await rendered.decode()
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 240
  const pixels = canvas.getContext("2d", { willReadFrequently: true })!
  pixels.drawImage(rendered, 0, 0)
  const sample = (x: number, y: number) => [...pixels.getImageData(x * 10, y * 10, 1, 1).data]
  return { center: sample(12, 12), circle: sample(12, 5), outside: sample(0, 0), expected: rgba(getComputedStyle(source).color) }
}
// External browser automation uses real pointer hover, then runs the same color
// and contrast checks. Synthetic pointer events cannot activate CSS :hover.
Object.assign(window, { toolStatusChecks: { assertErrorColors, errorColorSamples, assertOriginalIconColors } })
for (const state of ["running", "success", "error"] as const) document.querySelector(`#${state}`)!.addEventListener("click", () => changeState(state))

document.querySelector<HTMLButtonElement>("#run")!.addEventListener("click", async event => {
  const button = event.currentTarget as HTMLButtonElement
  const results = document.querySelector("#results")!
  button.disabled = true
  results.textContent = "Running…"
  const passed: string[] = []
  const check = (condition: unknown, label: string) => { if (!condition) throw new Error(label); passed.push(label) }
  const minima: ReturnType<typeof assertErrorColors>[] = []
  let pixels: Awaited<ReturnType<typeof errorIndicatorPixels>> | undefined
  const successColors = new Map<string, string>()
  normalIconPaints.clear()
  try {
    await until(() => !!document.querySelector('[data-ready="true"]'), "Real session providers did not initialize")
    for (const state of ["running", "success", "error", "running", "success"] as const) {
      changeState(state)
      await nextFrame()
      await until(() => rows().every(row => header(row)?.dataset.toolStatus === state), `All ToolItem dispatch routes did not expose ${state} status`)
      if (state === "error") {
        // Color transitions may still be finishing after a previous success.
        await until(() => rows().every(row => textElements(header(row)).every(element => rgba(getComputedStyle(element).color)[0] > rgba(getComputedStyle(element).color)[1] * 1.25)), "Failure text never became red")
        await until(() => errorColorSamples().every(sample => sample.color[3] > 0.999), "Failure labels did not finish their entry animation")
        minima.push(assertErrorColors())
        check(true, "failure text and filled indicators share accessible red; original icons retain their colors")
        pixels = await errorIndicatorPixels()
        check(pixels.center[3] === 0, "the X opening is truly transparent instead of background-colored")
        check(pixels.outside[3] === 0, "the area outside the circle is transparent")
        check(pixels.circle[3] === 255 && pixels.circle.slice(0, 3).every((channel, index) => Math.abs(channel - pixels!.expected[index]) <= 1), "the circle body is opaque and uses the actual failure color")
      }
      for (const row of rows()) {
        const current = header(row), name = row.dataset.case!
        const statusIcon = current.querySelector('svg.lucide-loader-circle')
        const indicators = current.querySelectorAll('[data-slot="tool-error-indicator"]')
        if (state === "running") {
          check(name === "generic" ? !!current.querySelector('[data-slot="badge"]') : !!statusIcon, `${name}: running feedback remains available`)
          check(indicators.length === 0, `${name}: retry running removes the error indicator`)
          if (reduced && statusIcon) check(getComputedStyle(statusIcon).animationName === "none", `${name}: reduced-motion spinner stays static`)
        } else {
          check(!current.querySelector('svg.lucide-check, svg.lucide-circle-check, svg.lucide-circle-alert, svg.lucide-circle-x, svg.lucide-x, svg.lucide-loader-circle, [data-slot="badge"]'), `${name}: ${state} has no obsolete status glyph or badge`)
          if (state === "error") {
            check(indicators.length === 1, `${name}: failure has exactly one error indicator`)
            const indicator = indicators[0], glyph = indicator.querySelector("svg.lucide-circle-x-filled")!
            const path = glyph?.querySelector("path")
            check(!!path && glyph.children.length === 1 && path.getAttribute("fill") === "currentColor" && path.getAttribute("stroke") === "none" && path.getAttribute("fill-rule") === "evenodd", `${name}: failure uses one filled path with a transparent X opening`)
            check(indicator.getAttribute("role") === "img" && indicator.getAttribute("aria-label") === i18n.t("toolCard.failed"), `${name}: error indicator has a localized accessible name`)
            check(JSON.stringify(originalIconPaints(row)) === normalIconPaints.get(name), `${name}: failure preserves tool and disclosure icon colors`)
            if (reduced) check(!indicator.getAnimations({ subtree: true }).some(animation => animation.playState === "running"), `${name}: reduced-motion alert does not animate`)
            check([...current.querySelectorAll(".sr-only")].some(element => element.textContent === i18n.t("toolCard.failed")), `${name}: failure remains accessible without a visible label`)
            check(!textElements(current).some(element => element.textContent === i18n.t("toolCard.failed")), `${name}: failure label is not visible`)
          }
          else {
            check(indicators.length === 0, `${name}: success removes the error indicator`)
            check(!current.querySelector('[aria-label="' + i18n.t("toolCard.completed") + '"]') && !textElements(current).some(element => element.textContent === i18n.t("toolCard.completed")), `${name}: success adds no completion ornament`)
            const color = getComputedStyle(textElements(current)[0]).color
            if (successColors.has(name)) check(color === successColors.get(name), `${name}: retry success restores the original text color`)
            else {
              successColors.set(name, color)
              const paints = originalIconPaints(row)
              check(paints.length >= 1, `${name}: original tool icon is present`)
              normalIconPaints.set(name, JSON.stringify(paints))
            }
          }
        }
        check(row.scrollWidth <= row.clientWidth + 1, `${name}: ${state} fits its column`)
      }
      check(document.documentElement.scrollWidth <= innerWidth, `${state}: page does not overflow horizontally`)
    }
    check(unexpected.length === 0, `Unexpected API requests: ${unexpected.join(", ")}`)
    check(rows().length === 14, "all direct components and ten production dispatch routes were tested")
    results.textContent = `PASS (${passed.length})\nMinimum error contrast: ${JSON.stringify(minima)}\nIndicator pixels: ${JSON.stringify(pixels)}\n${passed.join("\n")}`
  } catch (error) {
    results.textContent = `FAIL after ${passed.length} checks\n${error instanceof Error ? error.stack : String(error)}`
  } finally { button.disabled = false }
})
