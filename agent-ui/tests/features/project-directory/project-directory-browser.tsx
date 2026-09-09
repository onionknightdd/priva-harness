import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "next-themes"
import i18n from "../../../src/i18n"
import "../../../src/index.css"
import App from "../../../src/App"
import { installProjectDirectoryFixtures } from "./project-directory-fixtures"

const options = new URLSearchParams(location.search)
const language = options.has("zh") ? "zh-CN" : "en"
await i18n.changeLanguage(language)
const t = (key: string) => String(i18n.t(key))
const host = document.querySelector<HTMLDivElement>("#root")!
const root = createRoot(host)
const renderApp = () => root.render(<React.StrictMode><ThemeProvider attribute="class" forcedTheme={options.has("dark") ? "dark" : "light"}><App /></ThemeProvider></React.StrictMode>)

async function runChecks() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const results = document.querySelector<HTMLPreElement>("#results")!
  const fixtures = installProjectDirectoryFixtures()
  const passed: string[] = []
  const check = (name: string, condition: boolean) => {
    if (!condition) throw new Error(name)
    passed.push(name)
    results.textContent = passed.map((entry) => `PASS ${entry}`).join("\n")
  }
  const settle = async () => {
    for (let frame = 0; frame < 6; frame++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
  }
  const button = (name: string, parent: ParentNode = document) => {
    const element = [...parent.querySelectorAll<HTMLButtonElement>("button")].find((item) => (item.getAttribute("aria-label") || item.textContent?.trim()) === name && !item.closest('[aria-hidden="true"]'))
    if (!element) throw new Error(`Missing button: ${name}`)
    return element
  }
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
  const pathInput = () => document.querySelector<HTMLInputElement>(`input[aria-label="${t("directoryPicker.path")}"]`)!
  const click = async (element: HTMLElement) => { await act(async () => { element.focus(); element.click() }); await settle() }
  const fill = async (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(element, value)
      element.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }
  const go = async (path: string) => { await fill(pathInput(), path); await click(button(t("directoryPicker.go"), dialog())) }
  const row = (path: string) => document.querySelector<HTMLElement>(`[data-file-tree-item-id="${path}"]`)!
  const selected = (path: string) => Array.from(dialog()?.querySelectorAll('[aria-live="polite"] p') ?? []).some((item) => item.textContent === path)
  const draft = () => host.querySelector<HTMLTextAreaElement>("textarea")!
  const indicator = (path: string) => button(`${t("directoryPicker.change")}: ${path}`, host)
  const addFiles = async (names: string[]) => {
    const transfer = new DataTransfer()
    names.forEach((name) => transfer.items.add(new File([name], name, { type: "text/plain" })))
    await act(async () => {
      const input = host.querySelector<HTMLInputElement>('input[type="file"]')!
      input.files = transfer.files
      input.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await settle()
  }

  try {
    results.textContent = "Running…"
    await act(async () => { renderApp() })
    await settle()
    await click(button(t("sidebar.projects.addProject"), host))
    for (let attempt = 0; attempt < 10 && !selected("/work/existing"); attempt++) await settle()
    check("project header opens the shared picker at the current directory", selected("/work/existing"))
    check("path input receives focus", document.activeElement === pathInput())
    check("tree only contains directories and preserves shared row spacing", !dialog().textContent?.includes("notes.txt") && row("/work/existing").getBoundingClientRect().height === Number.parseFloat(row("/work").style.top))
    check("unopened folders load lazily", !fixtures.requests.some((request) => request.endsWith("path=%2Fwork%2Flazy")))
    await act(async () => {
      row("/").focus()
      row("/").dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }))
      row("/").dispatchEvent(new KeyboardEvent("keyup", { key: "End", bubbles: true }))
    })
    await act(async () => {
      row("/work/lazy").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
      row("/work/lazy").dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }))
    })
    await settle()
    check("keyboard expansion loads child directories", Boolean(row("/work/lazy/child")))

    await go("/missing")
    check("invalid paths leave the current selection and show the API error", selected("/work/existing") && dialog().textContent?.includes("Directory not found") === true && button(t("directoryPicker.use")).disabled)
    fixtures.directories.set("/missing", [])
    fixtures.directories.get("/")!.push("missing")
    await click(button(t("directoryPicker.retry")))
    check("retrying a typed path navigates and clears the input after recovery", selected("/missing") && pathInput().value === "")
    await go("~/other")
    check("typed paths use the canonical path returned by the server", selected("/work/other") && pathInput().value === "")
    await click(row("/work/denied"))
    await click(button(t("directoryPicker.use")))
    check("an unreadable directory cannot be confirmed", Boolean(dialog()) && dialog().textContent?.includes("Permission denied") === true)
    fixtures.failures.delete("/work/denied")
    fixtures.directories.set("/work/denied", [])
    await click(button(t("directoryPicker.retry")))
    check("read errors can be retried without closing the picker", !dialog().querySelector('[role="alert"]'))

    await go("/work")
    await click(button(t("fileBrowser.createDialog.title")))
    const nameInput = () => document.querySelector<HTMLInputElement>(`input[placeholder="${t("fileBrowser.createDialog.placeholder")}"]`)!
    await fill(nameInput(), "existing")
    await click(button(t("fileBrowser.createDialog.create"), nameInput().closest("form")!))
    check("duplicate folder errors remain in the create dialog", nameInput().closest("form")!.textContent?.includes("Folder already exists") === true)
    await fill(nameInput(), "new-project")
    await click(button(t("fileBrowser.createDialog.create"), nameInput().closest("form")!))
    check("creating a folder selects it after refreshing the tree", selected("/work/new-project") && Boolean(row("/work/new-project")))
    check("closing the nested create dialog returns focus inside the directory picker", document.activeElement === button(t("fileBrowser.createDialog.title"), dialog()))
    check("choosing and creating folders do not start an agent run", fixtures.sockets.length === 0)
    await click(button(t("directoryPicker.use")))
    check("Use opens a local draft in the chosen directory", !dialog() && Boolean(indicator("/work/new-project")) && draft().value === "")
    check("a directory without a session does not create a sidebar group", !host.querySelector('[data-sidebar="sidebar"]')?.textContent?.includes("new-project"))

    await fill(draft(), "Keep this draft")
    await addFiles(["ready.txt", "pending.txt"])
    await act(async () => { fixtures.uploads[0].complete() })
    await settle()
    const cwdTrigger = indicator("/work/new-project")
    await click(cwdTrigger)
    await go("/work/other")
    await click(button(t("directoryPicker.use")))
    check("changing cwd preserves draft text and both attachment chips", draft().value === "Keep this draft" && host.querySelectorAll('[data-slot="attachment"]').length === 2)
    check("changing cwd does not cancel an in-flight upload", !fixtures.uploads[1].aborted)
    check("confirming restores focus to the existing directory trigger", document.activeElement === cwdTrigger)
    await act(async () => { fixtures.uploads[1].complete() })
    await addFiles(["later.txt"])
    check("attachments added after a cwd change upload to the new directory", fixtures.uploads[2].body.get("directory") === "/work/other")
    await act(async () => { fixtures.uploads[2].complete() })
    await settle()
    await click(button(t("agentMessage.send"), host))
    const socket = fixtures.sockets[0]
    const init = socket.sent[0]
    check("first send creates a new run with the selected cwd and no sessionId", init.type === "init" && init.cwd === "/work/other" && !init.sessionId && ["pi", "claude"].includes(String(init.harness)))
    check("first send retains absolute paths from uploads before and after the directory change", String(init.text).includes("/work/new-project/.priva-attachments/ready.txt") && String(init.text).includes("/work/new-project/.priva-attachments/pending.txt") && String(init.text).includes("/work/other/.priva-attachments/later.txt"))
    check("cwd is locked as soon as the first message is sent", !host.querySelector('button[aria-label^="' + t("directoryPicker.change") + '"]'))
    await act(async () => { socket.bindSession() })
    await settle()
    check("the first session creates its project group in the sidebar", host.querySelector('[data-sidebar="sidebar"]')?.textContent?.includes("other") === true)
    await act(async () => { socket.reply({ type: "run.completed" }); socket.close() })
    await settle()
    const existingProject = [...host.querySelectorAll<HTMLElement>('[data-slot="collapsible"]')].find((item) => item.textContent?.includes("Existing conversation") && item.querySelector('button[aria-label="' + t("sidebar.projects.createSession") + '"]') && !item.textContent?.includes("New conversation"))
    if (!existingProject) throw new Error("Missing existing project group")
    await click(button(t("sidebar.projects.createSession"), existingProject))
    check("existing project plus starts a clean draft in that project's cwd", Boolean(indicator("/work/existing")) && draft().value === "" && fixtures.sockets.length === 1)

    await click(indicator("/work/existing"))
    fixtures.holdPaths.add("/slow")
    await go("/slow")
    const late = fixtures.held.get("/slow")!
    await click(button(t("fileBrowser.createDialog.cancel"), dialog()))
    check("closing aborts pending directory reads", late.signal?.aborted === true)
    await click(indicator("/work/existing"))
    await act(async () => { late.resolve(Response.json(fixtures.listing("/slow"))) })
    await settle()
    check("late responses from a closed picker cannot overwrite a reopened picker", selected("/work/existing") && !dialog().textContent?.includes("/slow"))
    const bounds = dialog().getBoundingClientRect()
    check("dialog and actions fit the viewport", bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && dialog().scrollWidth <= dialog().clientWidth)
    await click(row("/work/existing"))
    const scrollArea = dialog().querySelector<HTMLElement>("[data-file-tree-scroll]")!
    await act(async () => { scrollArea.scrollTop = 185 })
    await settle()
    const pinnedRows = [row("/"), row("/work"), row("/work/existing")]
    check("all ancestor rows stick while the directory list scrolls", pinnedRows.every((item) => item.dataset.stuck === "true"))
    check("sticky rows cover the top edge of the scroll area without a transparent gap", Math.abs(row("/").getBoundingClientRect().top - scrollArea.getBoundingClientRect().top) < 0.5)
    const selectedBackground = getComputedStyle(row("/work/existing").querySelector('[data-slot="tree-item-label"]')!).backgroundColor
    check("every pinned level keeps the selected background even without hover or selection", pinnedRows.every((item) => getComputedStyle(item.querySelector('[data-slot="tree-item-label"]')!).backgroundColor === selectedBackground) && row("/").getAttribute("aria-selected") === "false")
    check("sticky rows have an opaque backing behind indentation and rounded labels", pinnedRows.every((item) => !["transparent", "rgba(0, 0, 0, 0)"].includes(getComputedStyle(item).backgroundColor)))
    await act(async () => { scrollArea.scrollTop = 0 })
    await settle()
    check("unpinned ancestors return to their normal background while the selection remains", pinnedRows.every((item) => item.dataset.stuck === "false") && getComputedStyle(row("/").querySelector('[data-slot="tree-item-label"]')!).backgroundColor !== selectedBackground && getComputedStyle(row("/work/existing").querySelector('[data-slot="tree-item-label"]')!).backgroundColor === selectedBackground)
    await click(button(t("fileBrowser.createDialog.cancel"), dialog()))
    check(`all API traffic stays within the expected current-project endpoints (${fixtures.unexpected.join(", ")})`, fixtures.unexpected.length === 0)
    results.textContent += `\n\n${passed.length} checks passed`
  } catch (error) {
    results.textContent += `\nFAIL ${error instanceof Error ? error.stack : String(error)}`
    results.textContent += `\nDialog: ${dialog()?.textContent ?? "closed"}\nUnexpected requests: ${fixtures.unexpected.join(", ")}`
  } finally {
    await act(async () => { root.render(null) })
    fixtures.restore()
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false })
  }
}

if (options.has("manual")) {
  document.querySelector<HTMLElement>("#checks")!.hidden = true
  installProjectDirectoryFixtures()
  renderApp()
} else {
  document.querySelector<HTMLButtonElement>("#run")!.onclick = () => { void runChecks() }
}
