import { createInstance } from "i18next"
import { useState } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { I18nextProvider, initReactI18next } from "react-i18next"

import { AnalyzingImage } from "../../../src/components/loading-ui/analyzing-image"
import { ToolItem } from "../../../src/features/agent-message/components/assistant-process"
import { ImageGenToolItem, ImageReadToolItem } from "../../../src/features/agent-message/components/image-tool-item"
import { ImageEditToolItem } from "../../../src/features/agent-message/components/image-edit-tool-item"
import { isImageEditTool, isImageReadTool } from "../../../src/features/agent-message/image-tools"
import type { ToolCard } from "../../../src/features/agent-message/agent-message-data"
import type { ImageToolBlock } from "../../../src/features/agent-message/image-tool-data"
import { en } from "../../../src/i18n/locales/en"
import { zhCN } from "../../../src/i18n/locales/zh-CN"
import "../../../src/index.css"

const query = new URLSearchParams(location.search)
document.documentElement.classList.toggle("dark", query.has("dark"))
if (query.has("reduced-motion")) {
  const matchMedia = window.matchMedia.bind(window)
  window.matchMedia = (media) => media === "(prefers-reduced-motion)"
    ? Object.assign(new EventTarget(), { matches: true, media, onchange: null, addListener() {}, removeListener() {} }) as MediaQueryList
    : matchMedia(media)
}
const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: query.has("zh") ? "zh-CN" : "en",
  resources: { en: { translation: en }, "zh-CN": { translation: zhCN } },
  interpolation: { escapeValue: false },
})

function gen(id: string, output: string, status: "running" | "completed" = "completed", ok = true): ImageToolBlock {
  return {
    type: "tool_use", id, blockId: id, index: 0, name: "image_gen",
    input: { prompt: "山间的日光与静谧的湖面。\nQuiet sunlight on a mountain lake.", size: "1536x1024" },
    tool: { id, name: "image_gen", status, ok, output },
  }
}

const iconCases: ToolCard[] = [
  { id: "bash-running", name: "bash", status: "running", input: { command: "printf ready", description: "Terminal icon" }, output: "ready" },
  { id: "bash-completed", name: "bash", status: "completed", ok: true, input: { command: "pwd" }, output: "/workspace" },
  { id: "bash-failed", name: "shell", status: "completed", ok: false, input: { command: "exit 1" }, output: "Command exited with code 1" },
  { id: "read-running", name: "image_read", status: "running", output: "Reading the image…" },
  { id: "read-completed", name: "image_read", status: "completed", ok: true, output: "The image shows a mountain." },
  { id: "read-failed", name: "mcp__agentWorkshop__image_read", status: "completed", ok: false, output: '{"error":{"code":"upstream_error","message":"Original image_read error <detail>"}}' },
  { id: "edit-icon", name: "mcp__agentWorkshop__image_edit", status: "completed", ok: true, output: "/image-tool-fixtures/result.png" },
  { id: "edit-failed", name: "image_edit", status: "completed", ok: false, output: '{"error":{"message":"Original image_edit error <detail>"}}' },
  { id: "generic-icon", name: "test_tool", status: "completed", ok: true },
]

const portraitPath = "references/very-long-source-directory-for-responsive-file-path-verification/portrait.png"
function edit(id: string, status: "running" | "completed" = "completed", image_path = `source.png,\n${portraitPath}`): ImageToolBlock {
  return {
    type: "tool_use", id, blockId: id, index: 0, name: "image_edit",
    input: { prompt: "把日光改成月光，保留山峦和湖面的构图。\nTurn daylight into moonlight while keeping the mountain composition.", image_path },
    tool: { id, name: "image_edit", status, ok: true, output: status === "completed" ? "/image-tool-fixtures/result.png" : "" },
  }
}

export function Fixtures() {
  const [editStatus, setEditStatus] = useState<"running" | "completed">("running")
  return <main className="mx-auto max-w-3xl space-y-8 p-4 pb-12">
    <section data-case="edit-preview" id="edit-preview"><ImageEditToolItem cwd="/image-tool-fixtures" block={edit("edit-preview")} /></section>
    <section data-case="edit-live"><ImageEditToolItem cwd="/image-tool-fixtures" block={edit("edit-live", editStatus, "source.png")} /><button id="complete-edit" onClick={() => setEditStatus("completed")}>Complete edit</button></section>
    <section data-case="edit-retry"><ImageEditToolItem cwd="/image-tool-fixtures" block={edit("edit-retry", "completed", "retry.png")} /></section>
    {iconCases.map((tool) => <section key={tool.id} data-case={tool.id}>
      {isImageReadTool(tool.name)
        ? <ImageReadToolItem cwd="/image-tool-fixtures" block={{ type: "tool_use", id: tool.id, blockId: tool.id, index: 0, name: tool.name, input: { prompt: "Describe the mountain in this picture.", image_path: "source.png" }, tool }} />
        : isImageEditTool(tool.name)
          ? <ImageEditToolItem cwd="/image-tool-fixtures" block={{ ...edit(tool.id), name: tool.name, tool }} />
          : <ToolItem block={{ type: "tool_use", id: tool.id, blockId: tool.id, index: 0, name: tool.name, tool }} />}
    </section>)}
    <div className="flex items-center gap-4 text-muted-foreground">
      <AnalyzingImage active className="size-5" data-case="active-icon" />
      <AnalyzingImage active={false} className="size-5" data-case="completed-icon" />
    </div>
    <section data-case="gen"><ImageGenToolItem block={gen("gen", "/image-tool-fixtures/source.png")} /></section>
    <section data-case="retry"><ImageGenToolItem block={gen("retry", "/image-tool-fixtures/retry.png")} /></section>
    <section data-case="pending"><ImageGenToolItem block={gen("pending", "", "running")} /></section>
    <section data-case="failed"><ImageGenToolItem block={gen("failed", "The image service is unavailable.", "completed", false)} /></section>
    <section data-case="invalid-output"><ImageGenToolItem block={gen("invalid-output", '{"error":{"message":"Original image_gen error <detail>"}}')} /></section>
  </main>
}

const root = createRoot(document.getElementById("root")!)
function renderFixtures() {
  flushSync(() => root.render(<I18nextProvider i18n={i18n}><Fixtures key={crypto.randomUUID()} /></I18nextProvider>))
}
renderFixtures()

async function until(condition: () => boolean, label: string) {
  const deadline = performance.now() + 5000
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(`Timed out: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

async function runChecks() {
  const run = document.getElementById("run") as HTMLButtonElement
  run.disabled = true
  renderFixtures()
  const results = document.getElementById("results")!
  const passed: string[] = []
  const check = (label: string, condition: boolean) => {
    if (!condition) throw new Error(label)
    passed.push(label)
  }
  const item = (name: string) => document.querySelector<HTMLElement>(`[data-case="${name}"]`)!
  results.textContent = "Running…"
  try {
    await until(() => Boolean(item("gen")?.querySelector('button[aria-busy="false"]')), "generated image loaded")
    check("Gen shows prompt and requested size", item("gen").textContent!.includes("Quiet sunlight") && item("gen").textContent!.includes("1536x1024"))
    check("successful result is a decoded image", item("gen").querySelector("img")!.naturalWidth === 1200)
    check("running result keeps a loading placeholder", !item("pending").querySelector("img") && Boolean(item("pending").querySelector('[data-slot="skeleton"]')))
    check("tool failure retains the service message", item("failed").textContent!.includes("The image service is unavailable.") && !item("failed").querySelector("img"))
    check("invalid Gen output retains its original text", item("invalid-output").querySelector('[role="alert"]')!.textContent === '{"error":{"message":"Original image_gen error <detail>"}}')
    check("completed analyzing icon stops its scan", item("completed-icon").querySelectorAll("div").length === 1)
    if (query.has("reduced-motion")) check("reduced motion removes the active scan", item("active-icon").querySelectorAll("div").length === 1)

    const icon = (name: string) => item(name).querySelector<HTMLElement>('[data-slot="item-media"], button[aria-expanded] > span[aria-hidden="true"]')!
    check("Read uses analyzing-image for running, completed, and failed MCP calls", ["read-running", "read-completed", "read-failed"].every((name) => Boolean(icon(name).querySelector('[aria-label="Analyzing image"]')) && !icon(name).querySelector(".lucide-wrench")))
    check("Read icon fits the header and stays decorative", icon("read-failed").getBoundingClientRect().width <= 16 && icon("read-failed").getAttribute("aria-hidden") === "true")
    check("finished Read icons stop scanning", ["read-completed", "read-failed"].every((name) => icon(name).querySelector('[aria-label="Analyzing image"]')!.querySelectorAll("div").length === 1))
    check("running Read respects the reduced-motion setting", icon("read-running").querySelector('[aria-label="Analyzing image"]')!.querySelectorAll("div").length === (query.has("reduced-motion") ? 1 : 2))
    check("Edit uses Images while unrelated tools retain Wrench", Boolean(icon("edit-icon").querySelector(".lucide-images")) && Boolean(icon("generic-icon").querySelector(".lucide-wrench")))
    for (const name of ["read-completed", "read-failed", "edit-failed"]) {
      item(name).querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!.click()
      await until(() => Boolean(item(name).querySelector('button[aria-expanded="true"]')), `${name} expands`)
    }
    await until(() => Boolean(item("read-completed").querySelector('button[aria-busy="false"]')), "Read input image loads")
    check("expanded Read shows its prompt, source image, and model output", item("read-completed").textContent!.includes("Describe the mountain") && item("read-completed").querySelector("img")!.naturalWidth === 1200 && item("read-completed").textContent!.includes("The image shows a mountain."))
    check("Read resolves relative images against the session directory", new URL(item("read-completed").querySelector("img")!.src).searchParams.get("path") === "/image-tool-fixtures/source.png")
    check("failed Read and Edit retain exact original errors", ["read-failed", "edit-failed"].every((name) => item(name).querySelector('[role="alert"]')!.textContent === iconCases.find(tool => tool.id === name)!.output))
    check("Bash and shell restore SquareTerminal in every state", ["bash-running", "bash-completed", "bash-failed"].every((name) => Boolean(item(name).querySelector(".lucide-square-terminal")) && !item(name).querySelector('[data-slot="loading-ui-terminal"]')))
    if (query.has("zh")) check("image tool names match the requested Chinese labels", item("read-completed").querySelector('button[aria-expanded]')!.textContent!.includes("查看图片") && item("edit-icon").textContent!.includes("编辑图片") && item("gen").querySelector('button[aria-expanded]')!.textContent!.includes("创建图片"))

    const editPreview = item("edit-preview")
    const modeButton = (name: string, label: string) => Array.from(item(name).querySelectorAll<HTMLButtonElement>('[data-slot="toggle-group-item"]')).find((button) => button.textContent === label)!
    editPreview.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!.click()
    await until(() => editPreview.querySelectorAll('button[aria-busy="false"]').length === 2, "Edit side-by-side images load")
    check("Edit shows the input prompt before the mode controls", editPreview.textContent!.indexOf("Turn daylight") < editPreview.textContent!.indexOf("Side-by-side"))
    check("Edit defaults to side-by-side and exposes both paths", modeButton("edit-preview", "Side-by-side").getAttribute("aria-pressed") === "true" && editPreview.querySelector("dl")!.textContent!.includes("/image-tool-fixtures/source.png") && editPreview.querySelector("dl")!.textContent!.includes("/image-tool-fixtures/result.png"))
    const bounds = Array.from(editPreview.querySelectorAll("img")).map((image) => image.getBoundingClientRect())
    check("side-by-side images share a row without distortion", bounds[0].y === bounds[1].y && Math.abs(bounds[0].width - bounds[1].width) < 1 && Array.from(editPreview.querySelectorAll("img")).every((image) => getComputedStyle(image).objectFit === "contain"))
    modeButton("edit-preview", i18n.t("agentMessage.imageTools.sourceNumber", { number: 2 })).click()
    await until(() => editPreview.querySelector("img")?.naturalWidth === 600, "second source loads")
    check("source selection updates its image and full path while preserving the result", editPreview.querySelector("dl")!.textContent!.includes(portraitPath) && new URL(editPreview.querySelectorAll("img")[1].src).searchParams.get("path") === "/image-tool-fixtures/result.png")
    modeButton("edit-preview", "Slide").click()
    await until(() => Boolean(editPreview.querySelector<HTMLInputElement>('input[type="range"]:enabled')), "Slide becomes interactive")
    const range = editPreview.querySelector<HTMLInputElement>('input[type="range"]')!
    const beforeLayer = editPreview.querySelector<HTMLElement>('[data-slot="image-comparison-before"]')!
    check("Slide initially reveals half of the original", range.value === "50" && beforeLayer.style.clipPath.includes("50%"))
    range.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }))
    await until(() => range.value === "100", "End reveals original")
    check("keyboard comparison reaches the original endpoint", beforeLayer.style.clipPath.includes("0%"))
    range.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }))
    await until(() => range.value === "0", "Home reveals result")
    check("keyboard comparison reaches the result endpoint", beforeLayer.style.clipPath.includes("100%"))
    modeButton("edit-preview", "Side-by-side").click()
    await until(() => editPreview.querySelectorAll('button[aria-busy="false"]').length === 2, "return to side-by-side")
    check("switching modes retains the selected original", editPreview.querySelector("img")!.naturalWidth === 600)
    check("running Edit keeps the source and disables comparison until a result arrives", Boolean(item("edit-live").querySelector("img")) && Boolean(item("edit-live").querySelector('[data-slot="skeleton"]')) && modeButton("edit-live", "Slide").disabled)
    document.getElementById("complete-edit")!.click()
    await until(() => item("edit-live").querySelectorAll('button[aria-busy="false"]').length === 2, "live result arrives")
    check("live completion preserves the expanded card and enables comparison", item("edit-live").querySelector('button[aria-expanded]')!.getAttribute("aria-expanded") === "true" && !modeButton("edit-live", "Slide").disabled)
    check("failed Edit preserves its source preview and disables Slide", Boolean(item("edit-failed").querySelector("img")) && modeButton("edit-failed", "Slide").disabled)
    item("edit-retry").querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!.click()
    await until(() => Boolean(modeButton("edit-retry", "Slide")), "retry card opens")
    modeButton("edit-retry", "Slide").click()
    await until(() => modeButton("edit-retry", "Slide").getAttribute("aria-pressed") === "true" && Boolean(item("edit-retry").querySelector('[role="alert"]')), "comparison load failure")
    Array.from(item("edit-retry").querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === i18n.t("agentMessage.imageTools.retryPreview"))!.click()
    await until(() => Boolean(item("edit-retry").querySelector('input[type="range"]:enabled')), "comparison retry loads both images")
    check("failed comparison can reload and become interactive", item("edit-retry").querySelectorAll("img").length === 2)

    const readPreview = item("read-completed").querySelector<HTMLButtonElement>('button[aria-busy="false"]')!
    readPreview.focus()
    readPreview.click()
    await until(() => Boolean(document.querySelector('[role="dialog"] img')), "Read lightbox opens")
    check("Read preview opens its input image in the lightbox", new URL(document.querySelector<HTMLImageElement>('[role="dialog"] img')!.src).searchParams.get("path") === "/image-tool-fixtures/source.png")
    document.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click()
    await until(() => !document.querySelector('[role="dialog"]') && document.activeElement === readPreview, "Read lightbox restores focus")

    const preview = item("gen").querySelector<HTMLButtonElement>('button[aria-busy="false"]')!
    preview.focus()
    preview.click()
    await until(() => Boolean(document.querySelector('[role="dialog"] img')), "lightbox opens")
    check("thumbnail opens the image lightbox", document.querySelector('[role="dialog"]')!.getAttribute("aria-modal") === "true")
    document.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click()
    await until(() => !document.querySelector('[role="dialog"]'), "lightbox closes")
    await until(() => document.activeElement === preview, "lightbox restores focus after unmount")
    check("closing restores focus to the image", document.activeElement === preview)

    await until(() => Boolean(item("retry").querySelector('[role="alert"]')), "image load failure")
    check("unavailable files expose a retry action", item("retry").textContent!.includes(i18n.t("agentMessage.imageTools.loadFailed")))
    item("retry").querySelector<HTMLButtonElement>('button:not([aria-expanded])')!.click()
    await until(() => Boolean(item("retry").querySelector('button[aria-busy="false"]')), "image retry succeeds")
    check("retry reloads the preview", item("retry").querySelector("img")!.naturalWidth === 1200)
    check("no horizontal page overflow", document.documentElement.scrollWidth <= window.innerWidth)
    results.textContent = `PASS (${passed.length})\n${passed.join("\n")}`
  } catch (error) {
    results.textContent = `FAIL after ${passed.length} checks\n${error instanceof Error ? error.stack : String(error)}`
  } finally {
    run.disabled = false
  }
}

document.getElementById("run")!.addEventListener("click", runChecks)
import.meta.hot?.dispose(() => {
  document.getElementById("run")!.removeEventListener("click", runChecks)
  root.unmount()
})
