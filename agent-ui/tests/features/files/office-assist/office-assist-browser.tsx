import * as React from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"

import i18n from "../../../../src/i18n"
import "../../../../src/index.css"
import { SidebarProvider } from "../../../../src/components/ui/sidebar"
import { ComposerEditor, type ComposerEditorHandle } from "../../../../src/features/agent-message/components/composer-editor"
import type { FileAnnotationInput } from "../../../../src/features/agent-message/file-annotation"
import { parseMessageSelections } from "../../../../src/features/agent-message/message-select-action"
import { rememberFileExists } from "../../../../src/features/files/file-existence"
import type { FilePreviewMode, PreviewFile } from "../../../../src/features/files/model/file.types"
import { RichFilePreview } from "../../../../src/features/files/preview/rich-file-preview"
import { WorkspaceFilesProvider, useOptionalWorkspaceFiles } from "../../../../src/features/workspace/workspace-files-context"
import { docxFixture, pptxFixture } from "../preview/office-fixtures"

const query = new URLSearchParams(location.search)
const listeners = new AbortController()
document.documentElement.classList.toggle("dark", query.has("dark"))
if (query.has("zh")) await i18n.changeLanguage("zh-CN")

// Add one small real table to the shared fixture; the empty cell has no text DOM.
function pptxTableFixture() {
  const files = unzipSync(new Uint8Array(pptxFixture()))
  const emu = 9525
  const cell = (text = "") => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1800"/><a:t>${text}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`
  const table = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="Fixture table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${96 * emu}" y="${320 * emu}"/><a:ext cx="${600 * emu}" cy="${100 * emu}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="${300 * emu}"/><a:gridCol w="${300 * emu}"/></a:tblGrid><a:tr h="${50 * emu}">${cell("Table content")}${cell()}</a:tr><a:tr h="${50 * emu}">${cell("Second row")}${cell("Value")}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
  files["ppt/slides/slide1.xml"] = strToU8(strFromU8(files["ppt/slides/slide1.xml"]).replace("</p:spTree>", table + "</p:spTree>"))
  return zipSync(files).buffer as ArrayBuffer
}

function docxEmptyCellFixture() {
  const files = unzipSync(new Uint8Array(docxFixture()))
  const row = '<w:tr><w:trPr><w:trHeight w:val="720" w:hRule="atLeast"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Empty-cell row</w:t></w:r></w:p></w:tc></w:tr>'
  files["word/document.xml"] = strToU8(strFromU8(files["word/document.xml"]).replace("</w:tbl>", row + "</w:tbl>"))
  return zipSync(files).buffer as ArrayBuffer
}

const sources = {
  docx: URL.createObjectURL(new Blob([docxEmptyCellFixture()])),
  pptx: URL.createObjectURL(new Blob([pptxTableFixture()])),
}
const files: PreviewFile[] = ["docx", "pptx"].map((kind) => ({
  id: kind, path: "/office-assist-fixture/review." + kind, name: "review." + kind,
  mediaType: "application/octet-stream", status: "ready", renderKind: kind === "docx" ? "document" : "presentation",
  renderSource: sources[kind as keyof typeof sources],
}))
files.forEach((file) => rememberFileExists(file.path, true))
const originalFetch = window.fetch.bind(window)
window.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href)
  // Fixture links are pre-seeded above. No request may reach real file APIs.
  if (url.pathname.startsWith("/api/")) throw new Error("Unexpected real API request: " + url.pathname)
  return originalFetch(input, init)
}

const results = document.querySelector<HTMLPreElement>("#results")!
const root = createRoot(document.getElementById("root")!)
const initialDraft = "Existing chat draft. "
let latest = { draft: initialDraft, activeFileId: "docx", mode: "render" as FilePreviewMode, active: true, mounted: true }
let batches: readonly FileAnnotationInput[][] = []
let unhandled = ""
window.addEventListener("unhandledrejection", (event) => { unhandled = String(event.reason) }, { signal: listeners.signal })

export function Fixtures() {
  const [activeFileId, setActiveFileId] = React.useState("docx")
  const [mode, setMode] = React.useState<FilePreviewMode>("render")
  const [active, setActive] = React.useState(true)
  const [mounted, setMounted] = React.useState(true)
  const [draft, setDraft] = React.useState(initialDraft)
  const inputRef = React.useRef<HTMLDivElement>(null)
  const editorRef = React.useRef<ComposerEditorHandle>(null)
  const workspace = useOptionalWorkspaceFiles()!
  const register = workspace.registerFileAnnotationComposer
  React.useLayoutEffect(() => register((items) => {
    editorRef.current?.focus(true)
    const inserted = editorRef.current?.insertFileAnnotations(items) ?? false
    if (inserted) batches = [...batches, [...items]]
    return inserted
  }), [register])
  React.useLayoutEffect(() => { latest = { draft, activeFileId, mode, active, mounted } })
  return <>
    <nav className="mb-2 flex gap-4 text-sm">
      <button type="button" data-preview-active-toggle onClick={() => setActive((value) => !value)}>{active ? "Hide preview" : "Show preview"}</button>
      <button type="button" data-preview-mount-toggle onClick={() => setMounted((value) => !value)}>{mounted ? "Unmount preview" : "Remount preview"}</button>
    </nav>
    <div id="preview" className="flex border border-border" style={{ width: "min(1080px,100%)", height: 610, display: active ? undefined : "none" }}>
      {mounted && <RichFilePreview files={files} activeFileId={activeFileId} mode={mode} active={active}
        onActiveFileChange={setActiveFileId} onModeChange={setMode} onCloseAll={() => {}} onFileClose={() => {}} />}
    </div>
    <div className="mt-3 max-w-5xl rounded-md border border-border p-3" data-composer-fixture>
      <ComposerEditor ref={editorRef} inputRef={inputRef} draft={draft} placeholder="Chat draft"
        onChange={setDraft} onImagesPaste={() => {}} onKeyDown={() => false} />
    </div>
    <pre id="draft" className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap text-xs">{draft}</pre>
  </>
}

let mount = 0
function render() {
  batches = []
  unhandled = ""
  flushSync(() => root.render(
    <SidebarProvider className="block min-h-0" defaultOpen={false} stateCookieName={false} widthCookieName={false}>
      <WorkspaceFilesProvider><Fixtures key={++mount} /></WorkspaceFilesProvider>
    </SidebarProvider>,
  ))
}
render()

const host = () => document.getElementById("preview")!
const candidate = () => host().querySelector<HTMLElement>("[data-office-assist-candidate]")
const count = () => Number(host().querySelector("[data-office-assist-count]")?.textContent)
const menu = () => Array.from(document.querySelectorAll<HTMLElement>("[data-file-selection-actions]"))
  .find((element) => element.querySelector('[role="toolbar"]:not([inert])'))
const input = () => menu()?.querySelector<HTMLInputElement>("input[data-selection-action-input], [data-selection-action-input] input")
const saved = () => Array.from(host().querySelectorAll<HTMLElement>("[data-office-assist-saved]"))
const sleep = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check: () => unknown, label: string) {
  const deadline = performance.now() + 25_000
  while (!check()) {
    if (performance.now() > deadline) throw new Error("Timed out: " + label + "; " + host().textContent?.slice(0, 300))
    await sleep()
  }
}
function button(label: string, scope: ParentNode = document) {
  return Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((element) =>
    element.getAttribute("aria-label") === label || element.textContent?.trim() === label)
}
async function mode(value: "render" | "edit") {
  button(i18n.t(value === "edit" ? "filePreview.edit" : "filePreview.preview"), host())!.click()
  await until(() => latest.mode === value, "preview mode " + value)
  await ready()
}
async function ready() {
  await until(() => host().querySelector("[data-office-assist-overlay]") && host().querySelector("canvas")?.getBoundingClientRect().width, "Office renderer and picker ready")
  await sleep(100)
}
async function file(kind: "docx" | "pptx") {
  host().querySelector<HTMLButtonElement>('[role="tab"][data-value="' + kind + '"]')!.click()
  await until(() => latest.activeFileId === kind, kind + " file tab")
  await ready()
}
function move(x: number, y: number, altKey = false) {
  const target = document.elementFromPoint(x, y) ?? host()
  target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", isPrimary: true, pointerId: 1, buttons: 0, clientX: x, clientY: y, altKey }))
}
function wordPoint(text: string) {
  const layer = host().querySelector('[data-ooxml-selection-surface="docx"][data-page-index="0"]')!
  const span = Array.from(layer.querySelectorAll<HTMLElement>("span")).find((element) => element.textContent?.includes(text) && element.getBoundingClientRect().width > 0)!
  if (!span) throw new Error("DOCX text span not found: " + text)
  const rect = span.getBoundingClientRect()
  return { x: rect.left + Math.min(rect.width / 2, 30), y: rect.top + rect.height / 2 }
}
function slidePoint(x: number, y: number) {
  const rect = host().querySelector<HTMLCanvasElement>('[data-slide-index="0"] > canvas')!.getBoundingClientRect()
  return { x: rect.left + x * rect.width / 960, y: rect.top + y * rect.height / 540 }
}
async function hover(point: { x: number; y: number }, type: string, alt = false) {
  move(point.x, point.y, alt)
  await until(() => candidate()?.dataset.officeAssistCandidate === type, type + " hover frame")
}
async function openInput() {
  await until(() => button(i18n.t("filePreview.askAgent"), menu()), "Ask Agent action")
  button(i18n.t("filePreview.askAgent"), menu())!.click()
  await until(() => input() && document.activeElement === input() && candidate()?.dataset.officeAssistDraft === "true", "focused question and fixed frame")
}
async function clickElement(point: { x: number; y: number }) {
  const canvas = Array.from(host().querySelectorAll("canvas")).find((element) => {
    const bounds = element.getBoundingClientRect()
    return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom
  })!
  for (const type of ["pointerdown", "pointerup"]) {
    canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerType: "mouse", isPrimary: true, pointerId: 1,
      button: 0, buttons: type === "pointerdown" ? 1 : 0, clientX: point.x, clientY: point.y,
    }))
  }
  canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, clientX: point.x, clientY: point.y }))
  await until(() => input() && document.activeElement === input() && candidate()?.dataset.officeAssistDraft === "true", "element click opens focused question and fixed frame")
}
function enter(value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value)
  input()!.dispatchEvent(new Event("input", { bubbles: true }))
}
async function confirm(question: string) {
  enter(question)
  const previous = count()
  button(i18n.t("filePreview.confirmAgentQuestion"), menu())!.click()
  await until(() => count() === previous + 1 && !input(), "saved selection and count")
}
function outsideClick() {
  document.getElementById("outside")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true }))
}

document.getElementById("select-paragraph")!.addEventListener("click", () => {
  void (async () => {
    if (latest.activeFileId !== "docx") await file("docx")
    await mode("edit")
    await hover(wordPoint("Hello"), "paragraph")
  })().catch((reason) => {
    results.textContent = "FAIL " + (reason instanceof Error ? reason.stack : String(reason))
  })
}, { signal: listeners.signal })

document.getElementById("run")!.addEventListener("click", async () => {
  const run = document.getElementById("run") as HTMLButtonElement
  run.disabled = true
  results.textContent = "Running…"
  const checks: string[] = []
  const check = (label: string, condition: unknown) => { if (!condition) throw new Error(label); checks.push("PASS " + label); results.textContent = checks.join("\n") + "\nRunning…" }
  try {
    render()
    await ready()
    const word = wordPoint("Hello")
    move(word.x, word.y)
    await sleep(100)
    check("ordinary preview has no element-selection frame", !candidate())
    await mode("edit")
    await hover(wordPoint("Hello"), "paragraph")
    await clickElement(wordPoint("Hello"))
    const locked = candidate()!.getBoundingClientRect()
    const otherParagraph = wordPoint("Table")
    move(otherParagraph.x, otherParagraph.y)
    await sleep(80)
    check("clicking a DOCX paragraph opens question input and fixes its frame when moving to another element", candidate()?.dataset.officeAssistDraft === "true" && Boolean(input()) && Math.abs(candidate()!.getBoundingClientRect().top - locked.top) < 1 && Math.abs(candidate()!.getBoundingClientRect().left - locked.left) < 1)
    button(i18n.t("filePreview.officeAssist.cancel"), host())!.click()
    await until(() => !input() && !candidate(), "close current draft")
    check("frame close cancels only the unfinished selection", count() === 0)

    await hover(wordPoint("Hello"), "paragraph")
    await clickElement(wordPoint("Hello"))
    outsideClick()
    await until(() => !input() && candidate()?.dataset.officeAssistDraft !== "true", "outside click cancels draft")
    check("outside click returns to hover without saving", count() === 0)
    await hover(wordPoint("Hello"), "paragraph")
    await openInput()
    await confirm("Explain this paragraph")
    check("confirmation stores question and selection number 1", saved().some((frame) => frame.dataset.officeAssistSaved === "1"))
    await hover(wordPoint("Table"), "table", true)
    const tableBounds = candidate()!.getBoundingClientRect()
    const emptyWordCell = { x: tableBounds.left + tableBounds.width / 4, y: tableBounds.bottom - 10 }
    await hover(emptyWordCell, "table-cell")
    check("DOCX empty cells expose real cell geometry without text spans", candidate()?.dataset.officeAssistCandidate === "table-cell")
    await hover(emptyWordCell, "table", true)
    await openInput()
    await confirm("Review this entire table")
    check("Alt hover selects the entire DOCX table and stores number 2", count() === 2 && saved().some((frame) => frame.dataset.officeAssistSaved === "2"))
    await mode("render")
    await mode("edit")
    const modeCleared = count() === 0 && saved().length === 0 && !input()
    await hover(wordPoint("Hello"), "paragraph")
    await clickElement(wordPoint("Hello"))
    await confirm("Temporary selection before changing files")
    check("mode changes clear selections and reset the next selection number", modeCleared && count() === 1 && saved().some((frame) => frame.dataset.officeAssistSaved === "1"))

    await file("pptx")
    await hover(slidePoint(180, 145), "paragraph")
    check("PPTX textboxes use the same hover action", Boolean(button(i18n.t("filePreview.askAgent"), menu())))
    await hover(slidePoint(500, 345), "table-cell")
    await hover(slidePoint(500, 345), "table", true)
    const hoveredTable = candidate()!.getBoundingClientRect()
    // Releasing Alt for the click must lock the current table candidate instead
    // of running another hit test that changes the target back into a cell.
    await clickElement(slidePoint(500, 345))
    const tableStayedFixed = candidate()?.dataset.officeAssistCandidate === "table" && Math.abs(candidate()!.getBoundingClientRect().width - hoveredTable.width) < 1
    await confirm("Review this slide table")
    check("clicking a PPTX Alt-hovered table with Alt released keeps the whole table fixed", count() === 1 && tableStayedFixed)
    host().querySelector<HTMLButtonElement>("[data-office-assist-clear]")!.click()
    await until(() => count() === 0 && saved().length === 0, "clear all saved selections")
    await hover(slidePoint(180, 145), "paragraph")
    await openInput()
    await confirm("Explain this slide")
    check("clear resets the next selection number to 1", saved().some((frame) => frame.dataset.officeAssistSaved === "1"))
    await file("docx")
    check("file switching discards the previous batch instead of restoring stale selections", count() === 0 && saved().length === 0 && !input())

    await hover(wordPoint("Hello"), "paragraph")
    await clickElement(wordPoint("Hello"))
    await confirm("Temporary selection before hiding")
    await hover(wordPoint("Table"), "table", true)
    await openInput()
    document.querySelector<HTMLButtonElement>("[data-preview-active-toggle]")!.click()
    await until(() => !latest.active && !input(), "hidden preview clears input")
    document.querySelector<HTMLButtonElement>("[data-preview-active-toggle]")!.click()
    await until(() => latest.active, "preview is visible again")
    await ready()
    check("hiding and reopening the preview clears saved selections and the unfinished question", count() === 0 && saved().length === 0 && !input())

    await hover(wordPoint("Hello"), "paragraph")
    await clickElement(wordPoint("Hello"))
    await confirm("Temporary selection before unmounting")
    await hover(wordPoint("Table"), "table", true)
    await openInput()
    document.querySelector<HTMLButtonElement>("[data-preview-mount-toggle]")!.click()
    await until(() => !latest.mounted && !host().querySelector(".rich-file-preview") && !input(), "preview unmount clears floating input")
    document.querySelector<HTMLButtonElement>("[data-preview-mount-toggle]")!.click()
    await until(() => latest.mounted, "preview remount")
    await ready()
    check("unmounting and reopening the file preview starts without saved or draft selections", count() === 0 && saved().length === 0 && !input())

    await hover(wordPoint("Hello"), "paragraph")
    await clickElement(wordPoint("Hello"))
    await confirm("Explain this paragraph")
    await hover(wordPoint("Table"), "table", true)
    await clickElement(wordPoint("Table"))
    await confirm("Review this entire table")
    host().querySelector<HTMLButtonElement>("[data-office-assist-send]")!.click()
    await until(() => batches.length === 1 && count() === 0, "batch inserted and preview reset")
    const annotations = parseMessageSelections(latest.draft).filter((part) => part.type === "file_annotation")
    check("one batch adds both references and questions while preserving existing chat draft", batches[0].length === 2 && annotations.length === 2 && latest.draft.startsWith(initialDraft) && latest.draft.includes("Explain this paragraph") && latest.draft.includes("Review this entire table"))
    check("Office references carry file version and real source location", batches[0].every(({ annotation }) => (annotation.kind === "document" || annotation.kind === "presentation") && /^[a-f\d]{64}$/.test(annotation.fileRevision) && annotation.locator.part === "word/document.xml" && annotation.locator.xpath))
    const editor = document.querySelector<HTMLElement>('[data-agent-composer="prompt"]')!
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: !/Mac/.test(navigator.platform), metaKey: /Mac/.test(navigator.platform), bubbles: true, cancelable: true }))
    await until(() => latest.draft === initialDraft, "one undo restores original draft")
    check("the whole batch is one undo operation", editor.textContent === initialDraft)
    check("no unhandled asynchronous failures", !unhandled)
    results.textContent = checks.join("\n") + "\n" + checks.length + " Office Agent Assist checks passed"
  } catch (reason) {
    results.textContent = checks.join("\n") + "\nFAIL " + (reason instanceof Error ? reason.stack : String(reason))
  } finally {
    run.disabled = false
  }
}, { signal: listeners.signal })

function dispose() {
  listeners.abort()
  root.unmount()
  window.fetch = originalFetch
  Object.values(sources).forEach(URL.revokeObjectURL)
}
window.addEventListener("pagehide", dispose, { signal: listeners.signal })
import.meta.hot?.dispose(dispose)
