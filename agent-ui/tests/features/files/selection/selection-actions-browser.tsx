import * as React from "react"
import { createRoot } from "react-dom/client"
import i18n from "../../../../src/i18n"
import "../../../../src/index.css"

import { AgentShikiLineContent } from "../../../../src/components/agents/agent-shiki"
import type { PreviewFile } from "../../../../src/features/files/model/file.types"
import { SpreadsheetRenderer } from "../../../../src/features/files/preview/renderers/spreadsheet-renderer"
import { PreviewSelectionBridgeProvider, type PreviewSelection } from "../../../../src/features/files/selection"
import { SourceSelectionActions } from "../../../../src/features/files/selection/source-selection-actions"
import { xlsxFixture } from "../preview/office-fixtures"

type Mode = "source" | "xlsx" | "csv"
const host = document.querySelector<HTMLDivElement>("#preview")!
const results = document.querySelector<HTMLPreElement>("#results")!
const selectionOutput = document.querySelector<HTMLPreElement>("#selection")!
const outside = document.querySelector<HTMLButtonElement>("#outside")!
const root = createRoot(host)
const params = new URLSearchParams(location.search)
if (params.has("dark")) document.documentElement.classList.add("dark")
if (params.has("zh")) await i18n.changeLanguage("zh-CN")

const sources = {
  xlsx: URL.createObjectURL(new Blob([xlsxFixture()])),
  csv: URL.createObjectURL(new Blob(['\ufeffName,Value,Notes\r\nAlpha,12,"quoted, value"\r\n中文,20,"two\nlines"\r\n'])),
}
const sourceLines = ["const selected = 'Ask Agent about this source';", "const question = 'Explain the selected source';"]
let mode: Mode = "source"
let mount = 0
let selection: PreviewSelection | null = null
let submissions = 0
let unhandled = ""
document.addEventListener("submit", (event) => { event.preventDefault(); submissions++ }, true)
window.addEventListener("unhandledrejection", (event) => { unhandled = String(event.reason) })

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check: () => unknown, label: string) {
  const start = performance.now()
  while (!check()) {
    if (performance.now() - start > 20_000) throw new Error(label)
    await wait()
  }
}
const menu = () => Array.from(document.querySelectorAll<HTMLElement>("[data-file-selection-actions]"))
  .find((element) => element.querySelector('[role="toolbar"]:not([inert])'))
const promptInput = () => menu()?.querySelector<HTMLInputElement>("input[data-selection-action-input], [data-selection-action-input] input")
const askButton = () => Array.from(menu()?.querySelectorAll<HTMLButtonElement>("button") ?? [])
  .find((button) => button.textContent?.includes(i18n.t("filePreview.askAgent")))
const viewport = () => host.querySelector<HTMLElement>("[data-xlsx-viewport-input]")!
const formula = () => host.querySelector<HTMLInputElement>("input")?.value
const address = () => selection?.kind === "spreadsheet" ? selection.ranges[0]?.address : null
function sourceSelectionMatches(source: HTMLElement, text: string) {
  const nativeSelection = window.getSelection()
  return nativeSelection !== null && !nativeSelection.isCollapsed &&
    source.contains(nativeSelection.anchorNode) && source.contains(nativeSelection.focusNode) &&
    nativeSelection.toString() === text
}
function key(target: HTMLElement, value: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...options })
  target.dispatchEvent(event)
  return event
}
function enterText(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}
function outsideClick() {
  outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }))
  outside.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }))
  outside.click()
}
function snapshot() {
  return JSON.stringify(selection?.kind === "spreadsheet"
    ? { ranges: selection.ranges, text: selection.text, sheetName: selection.sheetName, formula: formula() }
    : null)
}
function show(nextMode: Mode) {
  mode = nextMode
  mount++
  selection = null
  selectionOutput.textContent = ""
  window.getSelection()?.removeAllRanges()
  const file: PreviewFile | null = nextMode === "source" ? null : {
    id: nextMode, path: "/fixture/test." + nextMode, name: "test." + nextMode,
    mediaType: nextMode === "csv" ? "text/csv" : "application/octet-stream",
    status: "ready", renderKind: "spreadsheet", renderSource: sources[nextMode],
  }
  root.render(
    <React.StrictMode>
      <PreviewSelectionBridgeProvider key={mount} activeFile={file} scopeKey={nextMode + mount} onSelectionChange={(next) => {
        selection = next
        selectionOutput.textContent = JSON.stringify(next, null, 2)
      }}>
        {file ? <SpreadsheetRenderer fileId={file.id} fileName={file.name} mediaType={file.mediaType} source={sources[nextMode as "xlsx" | "csv"]} /> : (
          <form className="h-full">
            <SourceSelectionActions filePath="/fixture/test.ts" content={sourceLines.join("\n")}>
              <div className="flex justify-end p-6">
                <pre id="source-text" tabIndex={-1} className="agent-shiki shiki agent-code-content max-w-full whitespace-normal font-code text-sm leading-5">
                  <code className="block font-code">
                    {sourceLines.map((line, index) => (
                      <span key={index} data-source-row={index + 1} className="flex min-h-5 min-w-full">
                        <span aria-hidden="true" className="w-7 shrink-0 select-none pr-3 text-right tabular-nums text-muted-foreground/35">{index + 1}</span>
                        <code data-source-line={index + 1} className="contents font-code">
                          <AgentShikiLineContent fallback={line} className="whitespace-pre-wrap pl-2" />
                        </code>
                      </span>
                    ))}
                  </code>
                </pre>
              </div>
            </SourceSelectionActions>
          </form>
        )}
      </PreviewSelectionBridgeProvider>
    </React.StrictMode>,
  )
}

async function selectFixture() {
  if (mode === "source") {
    await until(() => host.querySelector("#source-text"), "source fixture mounts")
    await wait()
    const source = host.querySelector<HTMLElement>("#source-text")!
    source.focus()
    const range = document.createRange()
    const first = source.querySelector('[data-source-row="1"] .line')!.firstChild!
    const last = source.querySelector('[data-source-row="2"] .line')!.firstChild!
    range.setStart(first, 0)
    range.setEnd(last, last.textContent!.length)
    const nativeSelection = window.getSelection()!
    nativeSelection.removeAllRanges()
    nativeSelection.addRange(range)
    document.dispatchEvent(new Event("selectionchange"))
  } else {
    await until(() => address() === "A1" && viewport(), mode + " fixture loads")
    viewport().focus()
    key(viewport(), "ArrowDown")
    await until(() => address() === "A2", mode + " selects A2")
    if (mode === "xlsx") {
      key(viewport(), "ArrowRight")
      await until(() => address() === "B2", "XLSX selects B2")
    }
    key(viewport(), "ArrowRight", { shiftKey: true })
    await until(() => address() === (mode === "xlsx" ? "B2:C2" : "A2:B2"), mode + " range is selected")
  }
  await until(askButton, mode + " selection actions appear")
}
async function openInput(pointer = false) {
  if (pointer) askButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }))
  else askButton()!.click()
  await until(() => promptInput() && document.activeElement === promptInput(), "Ask Agent input receives focus")
  await until(() => (menu()?.getBoundingClientRect().width ?? 0) >= Math.min(288, window.innerWidth - 16) - 2, "input width settles")
  return promptInput()!
}
function inViewport() {
  const rect = menu()!.getBoundingClientRect()
  return rect.left >= 7 && rect.right <= window.innerWidth - 7 && rect.top >= 0 && rect.bottom <= window.innerHeight + 1
}

for (const nextMode of ["source", "xlsx", "csv"] as const) {
  document.getElementById(nextMode)!.addEventListener("click", () => show(nextMode))
}
document.getElementById("select")!.addEventListener("click", () => {
  void selectFixture().catch((error) => { results.textContent = String(error) })
})
show("source")

document.querySelector<HTMLButtonElement>("#run")!.addEventListener("click", async (event) => {
  const button = event.currentTarget as HTMLButtonElement
  button.disabled = true
  results.textContent = "Running…"
  const checks: string[] = []
  const check = (label: string, passed: unknown) => {
    if (!passed) throw new Error(label)
    checks.push("PASS " + label)
  }
  const initialUrl = location.href
  let allInputsInViewport = true
  try {
    show("source")
    await selectFixture()
    const source = host.querySelector<HTMLElement>("#source-text")!
    const sourceText = window.getSelection()!.toString()
    const selectedBeforeInput = sourceSelectionMatches(source, sourceText)
    // Settle the entrance before comparing the persistent action bar.
    await wait(200)
    const toolbar = menu()!.querySelector<HTMLElement>('[role="toolbar"]')!
    const bar = toolbar.querySelector<HTMLElement>("[data-selection-action-bar]")!
    const icon = bar.querySelector<HTMLElement>("[data-selection-action-icon]")!
    const before = bar.getBoundingClientRect()
    const iconBefore = icon.getBoundingClientRect()
    let input = await openInput(true)
    const selectedAfterInputFocus = sourceSelectionMatches(source, sourceText)
    await wait(200)
    const after = bar.getBoundingClientRect()
    const iconAfter = icon.getBoundingClientRect()
    const row = toolbar.querySelector<HTMLElement>("[data-selection-action-question-row]")!
    const confirmButton = row.querySelector<HTMLButtonElement>("[data-selection-action-confirm]")!
    const rowBounds = row.getBoundingClientRect()
    const inputBounds = input.getBoundingClientRect()
    const confirmBounds = confirmButton.getBoundingClientRect()
    const confirmRadius = Number.parseFloat(getComputedStyle(confirmButton).borderRadius)
    const targetWidth = Math.min(288, window.innerWidth - 16)
    check("opening keeps the original Ask Agent capsule and its 14px icon above the question", menu()!.querySelector('[role="toolbar"]') === toolbar &&
      toolbar.querySelector("[data-selection-action-bar]") === bar && bar.querySelector("[data-selection-action-icon]") === icon &&
      Math.abs(after.width - before.width) <= 1 && Math.abs(after.height - 32) <= 1 &&
      Math.abs(iconAfter.width - 14) <= 1 && Math.abs(iconAfter.height - 14) <= 1 &&
      Math.abs((iconAfter.left - after.left) - (iconBefore.left - before.left)) <= 1 &&
      Math.abs((iconAfter.top - after.top) - (iconBefore.top - before.top)) <= 1 && Boolean(askButton()))
    allInputsInViewport &&= inViewport()
    check("a focused second-row input has a separate rounded-square confirm button", document.activeElement === input &&
      rowBounds.top >= after.bottom + 4 && Math.abs(rowBounds.width - targetWidth) <= 1 &&
      Math.abs(inputBounds.height - 32) <= 1 && Math.abs(confirmBounds.width - 32) <= 1 && Math.abs(confirmBounds.height - 32) <= 1 &&
      Math.abs(confirmBounds.left - inputBounds.right - 6) <= 1 && Math.abs(confirmBounds.top - inputBounds.top) <= 1 &&
      confirmRadius > 0 && confirmRadius < confirmBounds.width / 2 && confirmButton.parentElement === row)

    enterText(input, "A long question about this selected source. ".repeat(24))
    const text = input.value
    await wait()
    input.select()
    document.dispatchEvent(new Event("selectionchange"))
    await wait()
    const selectedAfterInputSelection = promptInput() === input && input.selectionStart === 0 && input.selectionEnd === text.length
    input.setSelectionRange(2, 5)
    document.dispatchEvent(new Event("selectionchange"))
    await wait()
    check("source selection restoration does not overwrite full or partial input selections", selectedAfterInputSelection &&
      input.selectionStart === 2 && input.selectionEnd === 5)
    input.setSelectionRange(text.length, text.length)
    const navigation = ["ArrowLeft", "ArrowRight", "Home", "End"].map((value) => key(input, value))
    input.scrollLeft = input.scrollWidth
    input.dispatchEvent(new Event("scroll"))
    await wait(80)
    check("input navigation remains native and horizontal text scrolling keeps it open", navigation.every((event) => !event.defaultPrevented) && document.activeElement === input && promptInput() === input && input.scrollLeft > 0 && input.value === text)

    key(input, "Escape", { isComposing: true })
    await wait()
    const composingEscapeKeptInput = promptInput() === input && document.activeElement === input
    const legacyImeEscape = key(input, "Escape", { keyCode: 229 })
    await wait()
    const legacyImeEscapeKeptInput = legacyImeEscape.keyCode === 229 && promptInput() === input && document.activeElement === input
    key(input, "Escape")
    await until(() => !promptInput() && askButton() && document.activeElement === askButton(), "Escape returns to the action button")
    const selectedAfterEscape = sourceSelectionMatches(source, sourceText)
    await openInput()
    outsideClick()
    await until(() => !menu(), "outside click dismisses source actions")
    check("IME Escape keeps the input; normal Escape returns to Ask Agent and outside click closes it", composingEscapeKeptInput && legacyImeEscapeKeptInput && !promptInput())
    check("native source selection excludes line numbers and is restored when returning to the action", selectedBeforeInput &&
      selectedAfterInputFocus && selectedAfterEscape &&
      !menu())

    show("xlsx")
    await until(() => address() === "A1" && viewport(), "XLSX click fixture loads")
    const grid = viewport()
    const gridBounds = grid.getBoundingClientRect()
    for (const type of ["pointerdown", "pointerup"]) {
      grid.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, isPrimary: true,
        pointerType: "mouse", button: 0, buttons: type === "pointerup" ? 0 : 1,
        clientX: gridBounds.left + 65, clientY: gridBounds.top + 72 }))
    }
    await until(() => address() === "A2" && askButton() && host.querySelector("[data-xlsx-selection-isolation]") &&
      !host.querySelector('[data-xlsx-hover-cell="A2"]'), "clicking A2 shows one enhanced selected outline")
    const clickedSelection = snapshot()
    const selectedBorder = host.querySelector<SVGElement>("[data-xlsx-selection-border]")!
    const isolation = host.querySelector<SVGElement>("[data-xlsx-selection-isolation]")!
    const glow = host.querySelector<SVGElement>("[data-xlsx-selection-glow]")!
    await wait(150)
    const restingGlow = Number(getComputedStyle(glow).opacity)
    check("selected cells have a crisp border and one-pixel isolation without corner handles",
      getComputedStyle(selectedBorder).strokeWidth === "2px" && getComputedStyle(isolation).strokeWidth === "4px" &&
      !host.querySelector("[data-xlsx-selection-corners]"))
    input = await openInput()
    enterText(input, "Explain this selected cell")
    await wait(200)
    check("question input subtly strengthens the selected halo", Number(getComputedStyle(glow).opacity) > restingGlow)
    const anchoredMenu = menu()!.getBoundingClientRect()
    grid.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, isPrimary: true,
      pointerType: "mouse", button: 0, buttons: 0, clientX: gridBounds.left + 65, clientY: gridBounds.top + 92 }))
    await until(() => host.querySelector('[data-xlsx-hover-cell="A3"]'), "hover continues while the question is open")
    const hoveredMenu = menu()!.getBoundingClientRect()
    check("click selection keeps hover active without changing the range, formula, question, focus or action anchor",
      snapshot() === clickedSelection && promptInput() === input && input.value === "Explain this selected cell" &&
      document.activeElement === input && Math.abs(hoveredMenu.left - anchoredMenu.left) <= 1 &&
      Math.abs(hoveredMenu.top - anchoredMenu.top) <= 1)
    outsideClick()
    await until(() => !menu(), "click fixture outside dismissal")

    for (const nextMode of ["xlsx", "csv"] as const) {
      show(nextMode)
      await selectFixture()
      const before = snapshot()
      await until(() => host.querySelector("[data-xlsx-selection-isolation]"), nextMode + " selection decoration appears")
      input = await openInput()
      allInputsInViewport &&= inViewport()
      enterText(input, "Explain this selected range")
      const confirm = menu()!.querySelector<HTMLButtonElement>("[data-selection-action-confirm]")!
      confirm.click()
      await wait(80)
      check(nextMode.toUpperCase() + " keeps its cell range and formula; Check has no submit action", snapshot() === before && confirm.type === "button" && submissions === 0 && location.href === initialUrl && promptInput()?.value === "Explain this selected range")
      key(input, "Escape")
      await until(() => !promptInput() && askButton(), nextMode + " Escape returns to actions")
      outsideClick()
      await until(() => !menu(), nextMode + " outside dismissal")
    }
    check("all expanded inputs stay in the viewport without submissions or async errors", allInputsInViewport && submissions === 0 && !unhandled)
    results.textContent = checks.join("\n") + "\n" + checks.length + " checks passed\n"
    show("source")
  } catch (error) {
    results.textContent = checks.join("\n") + "\nFAIL " + (error instanceof Error ? error.stack : String(error))
  } finally {
    button.disabled = false
  }
})
window.addEventListener("pagehide", () => {
  root.unmount()
  Object.values(sources).forEach(URL.revokeObjectURL)
})
