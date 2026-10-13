import * as React from "react"
import { createRoot } from "react-dom/client"
import i18n from "../../../../src/i18n"
import "../../../../src/index.css"
import { PreviewSelectionBridgeProvider, type PreviewSelection } from "../../../../src/features/files/selection"
import type { PreviewFile } from "../../../../src/features/files/model/file.types"
import { SpreadsheetRenderer } from "../../../../src/features/files/preview/renderers/spreadsheet-renderer"
import { PresentationRenderer } from "../../../../src/features/files/preview/renderers/presentation-renderer"
import { DocumentRenderer } from "../../../../src/features/files/preview/renderers/document-renderer"
import { docxFixture, pptxFixture, xlsxFixture, xlsxManySheetsFixture } from "./office-fixtures"

const host = document.querySelector<HTMLDivElement>("#preview")!
const results = document.querySelector<HTMLPreElement>("#results")!
const selectionOutput = document.querySelector<HTMLPreElement>("#selection")!
const root = createRoot(host)
const params = new URLSearchParams(location.search)
if (params.has("dark")) document.documentElement.classList.add("dark")
if (params.has("narrow")) host.style.width = "390px"
if (params.has("zh")) await i18n.changeLanguage("zh-CN")

const workers = new Set<Worker>()
const OriginalWorker = window.Worker
window.Worker = class extends OriginalWorker {
  constructor(url: string | URL, options?: WorkerOptions) { super(url, options); workers.add(this) }
  terminate() { workers.delete(this); super.terminate() }
}
let copied = ""
Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: async (text: string) => { copied = text } })
const longCellValue = Array.from({ length: 48 }, (_, index) =>
  "Line " + String(index + 1).padStart(2, "0") + ': complete CSV value, including "quotes" and 中文'
).join("\n")
const longSingleLineValue = "Horizontal overflow keeps the complete single-line cell value. ".repeat(12)
const largeCsv = Array.from({ length: 40 }, (_, row) =>
  Array.from({ length: 60 }, (_, column) => {
    const value = row === 39 && column === 59 ? longCellValue
      : row === 0 && column === 1 ? longSingleLineValue : "R" + (row + 1) + "C" + (column + 1)
    return '"' + value.replaceAll('"', '""') + '"'
  }).join(",")
).join("\r\n")
const sources = {
  docx: URL.createObjectURL(new Blob([docxFixture()])),
  xlsx: URL.createObjectURL(new Blob([xlsxFixture()])),
  pptx: URL.createObjectURL(new Blob([pptxFixture()])),
  csv: URL.createObjectURL(new Blob(['\ufeffName,Value,Notes\r\nAlpha,12,"quoted, value"\r\n中文,20,"two\nlines"\r\n'])),
  broken: URL.createObjectURL(new Blob(["Invalid Office file"])),
  largeCsv: URL.createObjectURL(new Blob([largeCsv])),
  manySheets: URL.createObjectURL(new Blob([xlsxManySheetsFixture()])),
}
let selection: PreviewSelection | null = null
let unhandled = ""
window.addEventListener("unhandledrejection", (event) => { unhandled = String(event.reason) })
const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check: () => unknown, label: string) {
  const start = performance.now()
  while (!check()) {
    if (performance.now() - start > 30_000) throw new Error(label + ": " + host.textContent?.slice(0, 300))
    await wait()
  }
}
function show(kind: "docx" | "xlsx" | "pptx" | "csv", source = sources[kind]) {
  selection = null
  const file: PreviewFile = { id: kind, path: "/fixture/test." + kind, name: "test." + kind, mediaType: kind === "csv" ? "text/csv" : "application/octet-stream", status: "ready", renderKind: kind === "docx" ? "document" : kind === "pptx" ? "presentation" : "spreadsheet", renderSource: source }
  root.render(
    <React.StrictMode>
      <PreviewSelectionBridgeProvider activeFile={file} scopeKey={kind + source} onSelectionChange={(next) => {
        selection = next
        selectionOutput.textContent = JSON.stringify(next, null, 2)
      }}>
        <React.Suspense fallback={<div>Loading renderer…</div>}>
          {kind === "docx" ? <DocumentRenderer fileId={file.id} source={source} /> : kind === "pptx" ? <PresentationRenderer fileId={file.id} source={source} /> : <SpreadsheetRenderer fileId={file.id} fileName={file.name} mediaType={file.mediaType} source={source} />}
        </React.Suspense>
      </PreviewSelectionBridgeProvider>
    </React.StrictMode>
  )
}
const viewport = () => host.querySelector<HTMLElement>("[data-xlsx-viewport-input]")!
const cellText = (text: string) => Array.from(host.querySelectorAll<HTMLElement>("span")).find((span) => span.textContent === text && span.getBoundingClientRect().width > 0)
const formula = () => host.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea")?.value
const selectedAddress = () => selection?.kind === "spreadsheet" ? selection.ranges[0]?.address : null
function pointer(target: HTMLElement, x: number, y: number, type = "pointerdown", shiftKey = false) {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, isPrimary: true, pointerType: "mouse", button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y, shiftKey }))
}
function clickAt(target: HTMLElement, x: number, y: number, shiftKey = false) {
  pointer(target, x, y, "pointerdown", shiftKey)
  pointer(target, x, y, "pointerup", shiftKey)
}
function key(value: string, options: KeyboardEventInit = {}) {
  viewport().dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...options }))
}
for (const kind of ["docx", "xlsx", "pptx", "csv"] as const) document.getElementById(kind)!.addEventListener("click", () => show(kind))
show("xlsx")

async function runSpreadsheetChecks(event: MouseEvent) {
  const button = event.currentTarget as HTMLButtonElement
  const formulaOnly = button.id === "run-formula"
  const fullRunButton = document.querySelector<HTMLButtonElement>("#run")!
  const runButtons = [fullRunButton, document.querySelector<HTMLButtonElement>("#run-spreadsheet")!, document.querySelector<HTMLButtonElement>("#run-formula")!]
  runButtons.forEach((runButton) => { runButton.disabled = true })
  results.textContent = formulaOnly ? "Running formula bar checks…" : "Running spreadsheet checks…"
  const initialWidth = host.style.width
  const initialHeight = host.style.height
  const checks: string[] = []
  const check = (name: string, passed: unknown) => { if (!passed) throw new Error(name); checks.push("PASS " + name) }
  try {
    show("csv", sources.largeCsv)
    await until(() => selectedAddress() === "A1" && viewport() && formula() === "R1C1", "large CSV load")
    if (formulaOnly) {
      const input = host.querySelector<HTMLInputElement>("input")!
      const toggle = host.querySelector<HTMLButtonElement>("button[aria-expanded]")!
      const formulaPopup = () => document.getElementById(toggle.getAttribute("aria-controls") ?? "")
      const dismiss = async (popup: HTMLElement) => {
        const textarea = popup.querySelector<HTMLTextAreaElement>("textarea")!
        textarea.focus()
        textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
        await until(() => toggle.getAttribute("aria-expanded") === "false" && !popup.isConnected, "formula dropdown dismissal")
      }
      input.focus()
      input.setSelectionRange(1, 3)
      input.click()
      await wait()
      check("short formula input stays closed and supports text selection", toggle.getAttribute("aria-expanded") === "false" && document.activeElement === input && input.selectionStart === 1 && input.selectionEnd === 3 && getComputedStyle(input).userSelect !== "none")
      key("ArrowRight")
      await until(() => selectedAddress() === "B1" && formula() === longSingleLineValue, "single-line overflow cell")
      check("the single-line test value is horizontally clipped", input.scrollWidth > input.clientWidth && !input.value.includes("\n"))
      input.click()
      await until(() => toggle.getAttribute("aria-expanded") === "true" && formulaPopup()?.querySelector("textarea"), "single-line input click expansion")
      const singleLinePopup = formulaPopup()!
      check("clicking horizontally clipped input opens its complete single-line value", singleLinePopup.querySelector<HTMLTextAreaElement>("textarea")!.value === longSingleLineValue)
      await dismiss(singleLinePopup)
      key("ArrowLeft")
      await until(() => selectedAddress() === "A1" && formula() === "R1C1", "return to first CSV cell")
      toggle.click()
      await until(() => toggle.getAttribute("aria-expanded") === "true" && formulaPopup()?.querySelector("textarea"), "short formula arrow expansion")
      const shortPopup = formulaPopup()!
      await until(() => shortPopup.getBoundingClientRect().height > 0 && shortPopup.getBoundingClientRect().height < 70, "content-sized short formula dropdown")
      const shortTextarea = shortPopup.querySelector<HTMLTextAreaElement>("textarea")!
      check("the arrow opens a compact dropdown for a short value", shortTextarea.value === "R1C1" && shortTextarea.scrollHeight <= shortTextarea.clientHeight + 1)
      await dismiss(shortPopup)
    }
    // 98 synchronous key events cover 2,400 populated cells without a slow per-cell loop.
    for (let row = 1; row < 40; row++) key("ArrowDown", { shiftKey: true })
    for (let column = 1; column < 60; column++) key("ArrowRight", { shiftKey: true })
    await until(() => selectedAddress() === "A1:BH40", "large CSV selection")
    await until(() => formula()?.includes("Line 48"), "active cell outside the 2,000-cell selection text limit")
    check("CSV formula bar retains the active cell beyond 2,000 selected values", formula() === longCellValue.replaceAll("\n", ""))

    const toggle = host.querySelector<HTMLButtonElement>("button[aria-expanded]")!
    check("formula expansion starts collapsed and has an accessible label", toggle?.getAttribute("aria-expanded") === "false" && toggle.getAttribute("aria-label"))
    const formulaRow = toggle.closest<HTMLElement>('[data-slot="input-group"]')!
    const rowBefore = formulaRow.getBoundingClientRect()
    const gridBefore = viewport().getBoundingClientRect()
    const formulaPopup = () => document.getElementById(toggle.getAttribute("aria-controls") ?? "")
    if (formulaOnly) host.querySelector<HTMLInputElement>("input")!.click()
    else toggle.click()
    await until(() => toggle.getAttribute("aria-expanded") === "true" && formulaPopup()?.querySelector("textarea"), "formula dropdown")
    const popup = formulaPopup()!
    const textarea = popup.querySelector<HTMLTextAreaElement>("textarea")!
    check("formula dropdown exposes the complete multiline value as read-only text", textarea.readOnly && textarea.value === longCellValue && toggle.getAttribute("aria-controls") === popup.id && !host.contains(popup))
    await until(() => {
      const popupRect = popup.getBoundingClientRect()
      return Math.abs(popupRect.width - rowBefore.width) <= 1 && Math.abs(popupRect.left - rowBefore.left) <= 1 &&
        popupRect.top >= rowBefore.bottom - 1 && popupRect.top <= rowBefore.bottom + 12
    }, "formula dropdown anchor and width")
    const rowOpen = formulaRow.getBoundingClientRect()
    const gridOpen = viewport().getBoundingClientRect()
    check("equal-width formula dropdown opens below the fixed row without moving the grid", Math.abs(rowOpen.top - rowBefore.top) <= 1 && Math.abs(rowOpen.height - rowBefore.height) <= 1 && Math.abs(gridOpen.top - gridBefore.top) <= 1 && Math.abs(gridOpen.height - gridBefore.height) <= 1)
    await until(() => textarea.clientHeight > 0 && textarea.scrollHeight > textarea.clientHeight, "formula dropdown scroll area")
    textarea.scrollTop = textarea.scrollHeight
    check("expanded formula text stays within 160px and scrolls vertically to its last line", textarea.getBoundingClientRect().height <= 161 && ["auto", "scroll"].includes(getComputedStyle(textarea).overflowY) && textarea.scrollTop > 0 && textarea.scrollTop + textarea.clientHeight >= textarea.scrollHeight - 1)
    textarea.focus()
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
    await until(() => toggle.getAttribute("aria-expanded") === "false" && host.querySelector("input") && !popup.isConnected, "formula dropdown Escape dismissal")
    const rowClosed = formulaRow.getBoundingClientRect()
    const gridClosed = viewport().getBoundingClientRect()
    check("Escape closes the dropdown without changing the formula value or layout", formula() === longCellValue.replaceAll("\n", "") && Math.abs(rowClosed.top - rowBefore.top) <= 1 && Math.abs(rowClosed.height - rowBefore.height) <= 1 && Math.abs(gridClosed.top - gridBefore.top) <= 1 && Math.abs(gridClosed.height - gridBefore.height) <= 1)

    if (formulaOnly) {
      results.textContent = checks.join("\n") + "\n" + checks.length + " formula bar checks passed"
      return
    }

    show("xlsx", sources.manySheets)
    await until(() => selectedAddress() === "A1" && host.querySelectorAll('[role="tab"]').length === 24, "many-sheet XLSX load")
    const tabs = host.querySelector<HTMLElement>('[role="tablist"]')!
    const firstTab = tabs.querySelector<HTMLButtonElement>('[role="tab"]')!
    const footer = tabs.closest<HTMLElement>('[data-slot="tabs"]')!.parentElement!
    host.style.width = "390px"
    host.style.height = "420px"
    await until(() => host.getBoundingClientRect().width <= 390 && tabs.clientWidth < 390 && tabs.scrollWidth > tabs.clientWidth, "sheet-tab resize")
    tabs.scrollLeft = tabs.scrollWidth
    await wait()
    check("many long worksheet tabs have a horizontal scroll range", tabs.scrollLeft > 0)
    tabs.scrollLeft = 0
    await wait()
    const firstRect = firstTab.getBoundingClientRect()
    const tabsRect = tabs.getBoundingClientRect()
    check("the first worksheet tab remains reachable on the left after resize", firstRect.left >= tabsRect.left - 1 && firstRect.left < tabsRect.right && firstRect.right <= tabsRect.right + 1)
    firstTab.click()
    await until(() => formula() === "Sheet 01 - Quarterly report", "first worksheet selection")
    viewport().scrollTop = 600
    await wait()
    const footerRect = footer.getBoundingClientRect()
    const previewRect = host.getBoundingClientRect()
    check("worksheet tabs stay at the preview bottom after resizing and grid scrolling", footerRect.height > 0 && Math.abs(footerRect.bottom - (previewRect.bottom - host.clientTop)) <= 2 && tabsRect.bottom <= footerRect.bottom)
    results.textContent = checks.join("\n") + "\n" + checks.length + " spreadsheet checks passed"
  } catch (error) {
    results.textContent = checks.join("\n") + "\nFAIL " + (error instanceof Error ? error.stack : String(error))
  } finally {
    host.style.width = initialWidth
    host.style.height = initialHeight
    runButtons.forEach((runButton) => { runButton.disabled = false })
  }
}
document.querySelector<HTMLButtonElement>("#run-spreadsheet")!.addEventListener("click", runSpreadsheetChecks)
document.querySelector<HTMLButtonElement>("#run-formula")!.addEventListener("click", runSpreadsheetChecks)

document.querySelector<HTMLButtonElement>("#run")!.addEventListener("click", async (event) => {
  const button = event.currentTarget as HTMLButtonElement
  button.disabled = true
  results.textContent = "Running…"
  const checks: string[] = []
  const check = (name: string, passed: unknown) => { if (!passed) throw new Error(name); checks.push("PASS " + name) }
  try {
    root.render(null)
    await until(() => !host.firstChild && workers.size === 0, "initial cleanup")
    unhandled = ""
    show("xlsx")
    await until(() => selectedAddress() === "A1" && viewport(), "XLSX load")
    check("XLSX uses Canvas and preserves the formula bar / sheet tabs", host.querySelector("canvas") && !host.querySelector("table") && formula() === "Name" && host.querySelectorAll('[role="tab"]').length === 2)
    const input = viewport()
    const inputRect = input.getBoundingClientRect()
    // The fixture has a 22px header, a 30pt first row, and 20px ordinary rows.
    const alpha = { left: inputRect.left + 60, top: inputRect.top + 62, height: 20 }
    clickAt(input, alpha.left + 8, alpha.top + alpha.height / 2)
    await until(() => selectedAddress() === "A2", "cell click")
    key("ArrowRight")
    await until(() => selectedAddress() === "B2" && formula() === "12", "keyboard selection")
    key("ArrowRight", { shiftKey: true })
    await until(() => selectedAddress() === "B2:C2", "Shift selection")
    check("zero-based selection, cached text and formula remain available", selection?.kind === "spreadsheet" && selection.ranges[0].rowStart === 1 && selection.text === "12\t20" && formula() === "=SUM(B2,8)")
    key("c", { ctrlKey: true })
    await until(() => copied === "12\t20", "XLSX copy")
    check("XLSX copies the selected range as TSV", copied === "12\t20")
    clickAt(input, inputRect.left + 15, alpha.top + alpha.height / 2)
    await until(() => selectedAddress() === "A2:AO2", "row selection")
    check("whole-row selection extends beyond the old 40-column limit", selectedAddress() === "A2:AO2")
    clickAt(input, alpha.left + 8, inputRect.top + 10)
    await until(() => selectedAddress() === "A1:A600", "column selection")
    check("whole-column selection extends beyond the old 500-row limit", selectedAddress() === "A1:A600")
    const secondTab = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((tab) => tab.textContent === "第二页")!
    secondTab.click()
    await until(() => selection?.kind === "spreadsheet" && selection.sheetName === "第二页", "sheet change")
    check("sheet switching clears the previous range and updates formula / context", selectedAddress() === "A1" && formula() === "第二页内容")

    show("pptx")
    await until(() => cellText("Hello Office preview"), "PPTX load")
    const text = cellText("Hello Office preview")!
    const range = document.createRange()
    range.selectNodeContents(text)
    const nativeSelection = window.getSelection()!
    nativeSelection.removeAllRanges()
    nativeSelection.addRange(range)
    document.dispatchEvent(new Event("selectionchange"))
    await until(() => selection?.kind === "presentation", "PPTX selection")
    check("PPTX text selection retains slide, shape identity and native pixel boxes", selection?.kind === "presentation" && selection.text === "Hello Office preview" && selection.slideIndexes[0] === 0 && selection.nodeIds?.includes("2") && selection.boxes!.length > 0 && selection.boxes![0].width > 0)
    nativeSelection.removeAllRanges()
    document.dispatchEvent(new Event("selectionchange"))
    await until(() => selection === null, "PPTX deselect")
    check("PPTX collapsed selection clears the shared context", selection === null)

    show("docx")
    await until(() => cellText("preview"), "DOCX load")
    check("DOCX renders document text and tables through the new canvas viewer", host.querySelector("canvas") && cellText("Table ") && cellText("中文表格"))
    range.setStart(cellText("Hello ")!.firstChild!, 0)
    range.setEnd(cellText("preview")!.firstChild!, "preview".length)
    nativeSelection.removeAllRanges()
    nativeSelection.addRange(range)
    document.dispatchEvent(new Event("selectionchange"))
    await until(() => selection?.kind === "document", "DOCX selection")
    check("DOCX retains text, page-point boxes and real source locators", selection?.kind === "document" && selection.text === "Hello Word preview" && selection.pageIndexes[0] === 0 && selection.boxes!.length > 0 && selection.boxes![0].x > 60 && selection.boxes![0].x < 85 && selection.runs.some((run) => run.source?.story === "body"))
    nativeSelection.removeAllRanges()
    document.dispatchEvent(new Event("selectionchange"))
    await until(() => selection === null, "DOCX deselect")
    check("DOCX collapsed selection clears the shared context", selection === null)

    show("csv")
    await until(() => selectedAddress() === "A1" && viewport(), "CSV load")
    check("CSV uses the same canvas viewer and formula bar as XLSX", host.querySelector("canvas") && !host.querySelector("table") && formula() === "Name")
    key("ArrowDown")
    await until(() => selectedAddress() === "A2", "CSV select")
    key("ArrowRight", { shiftKey: true })
    await until(() => selectedAddress() === "A2:B2", "CSV Shift select")
    key("c", { ctrlKey: true })
    await until(() => copied === "Alpha\t12", "CSV copy")
    key("ArrowRight")
    await until(() => formula() === "quoted, value", "CSV quoted comma")
    key("ArrowDown")
    await until(() => selectedAddress() === "C3" && selection?.text === "two\nlines", "CSV quoted newline")
    key("ArrowLeft")
    await until(() => selectedAddress() === "B3", "CSV navigation")
    key("ArrowLeft")
    await until(() => formula() === "中文", "CSV Chinese")
    check("CSV retains quoted fields, Chinese text, selection and copy", copied === "Alpha\t12" && formula() === "中文")

    for (const kind of ["docx", "xlsx", "pptx"] as const) {
      show(kind, sources.broken)
      await until(() => host.querySelector('[role="alert"]'), kind + " error")
      check(kind + " malformed input shows an error and clears selection", selection === null)
      show(kind)
      await until(() => kind === "xlsx" ? selectedAddress() === "A1" : cellText(kind === "docx" ? "preview" : "Hello Office preview"), kind + " recovery")
    }
    show("xlsx")
    await wait(10)
    show("pptx")
    await until(() => cellText("Hello Office preview"), "rapid format switch")
    check("late XLSX results do not overwrite the active PPTX view", !host.querySelector("input") && selection === null)
    root.render(null)
    await until(() => workers.size === 0 && !host.firstChild, "worker teardown")
    check("all parser workers are released and no async rejection escapes", !unhandled)
    results.textContent = checks.join("\n") + "\n" + checks.length + " checks passed"
    show("xlsx")
  } catch (error) {
    results.textContent = checks.join("\n") + "\nFAIL " + (error instanceof Error ? error.stack : String(error)) + (unhandled ? "\nUnhandled: " + unhandled : "")
  } finally { button.disabled = false }
})
window.addEventListener("pagehide", () => { root.unmount(); Object.values(sources).forEach(URL.revokeObjectURL) })
