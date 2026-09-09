import * as React from "react"
import { createRoot } from "react-dom/client"
import i18n from "../../../src/i18n"
import "../../../src/index.css"
import { ResourceBrowser } from "../../../src/features/resources/resource-page"
import type { ResourceList, ResourceSource, SkillDetail } from "../../../src/features/resources/resource-api"

const host = document.querySelector<HTMLDivElement>("#page")!
const output = document.querySelector<HTMLPreElement>("#results")!
const root = createRoot(host)
const mobile = new URLSearchParams(location.search).has("mobile")
if (mobile) host.style.width = "100%"
const source: ResourceSource = { id: "global", harness: "claude", scope: "global", origin: "directory", label: "Global", path: "/fixture/skills", cwd: null, writable: true, canAdd: true }
const projects = ["/fixture/alpha", "/fixture/beta"]
const markdown = "---\nname: global-skill\ndescription: Fixture\n---\n# Preview heading\n\n" + "Paragraph to scroll.\n\n".repeat(100)
const files = { "SKILL.md": markdown, "script.py": 'print("hello")\nvalue = 42\n', "notes.unknown": "plain file\nsecond line", "diagram.svg": '<svg xmlns="http://www.w3.org/2000/svg" />' }
function skill(name: string, origin: ResourceSource): SkillDetail {
  return { id: name, name, description: "Fixture", sourceId: origin.id, source: origin, path: `${origin.path}/${name}`, filePath: `${origin.path}/${name}/SKILL.md`, enabled: true, canToggle: true, canDelete: true, toggleDescription: "", content: markdown, files: [...Object.entries(files).map(([path, text]) => ({ path, size: text.length })), { path: "image.PNG", size: 100 }, { path: "archive.zip", size: 100 }] }
}
const skills = [skill("global-skill", source), ...projects.map((cwd) => skill(cwd.split("/").at(-1)! + "-skill", { ...source, id: cwd, cwd, scope: "project", path: `${cwd}/.claude/skills` }))]

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(ready: () => unknown, message: string) {
  const start = performance.now()
  while (!ready()) { if (performance.now() - start > 15000) throw new Error(`Timed out: ${message}`); await wait() }
}
const visible = (element: Element) => element.getClientRects().length > 0
const tab = (mode: string) => host.querySelector<HTMLButtonElement>(`[data-slot="tabs-trigger"][value="${mode}"]`) ?? Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((item) => item.textContent === i18n.t(mode === "source" ? "resources.sourceCode" : "resources.preview"))!
const activePanel = () => host.querySelector<HTMLElement>('[data-slot="tabs-content"][data-state="active"]')!
const row = (name: string) => Array.from(host.querySelectorAll<HTMLElement>('[role="treeitem"]')).find((item) => visible(item) && item.querySelector('[data-file-tree-label]')?.textContent === name) ?? Array.from(host.querySelectorAll<HTMLElement>('[role="treeitem"]')).find((item) => visible(item) && item.textContent?.includes(name))!

document.querySelector<HTMLButtonElement>("#run")!.addEventListener("click", async (event) => {
  const button = event.currentTarget as HTMLButtonElement
  button.disabled = true
  output.textContent = "Running…"
  const originalFetch = window.fetch
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator.clipboard, "writeText")
  let copiedText = ""
  Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: async (text: string) => { copiedText = text } })
  const requests: { method: string; path: string }[] = []
  const checks: string[] = []
  let failToggle = false
  const check = (name: string, condition: unknown) => { if (!condition) throw new Error(name); checks.push(`PASS ${name}`) }
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href)
    if (!url.pathname.startsWith("/api/sandbox/resource/")) return originalFetch(input, init)
    const method = init?.method ?? "GET"
    requests.push({ method, path: url.pathname + url.search })
    await wait(80)
    if (url.pathname === "/api/sandbox/resource/skills") {
      const list: ResourceList = { groups: skills.filter((item) => !url.searchParams.get("cwd") || item.source.scope === "global" || item.source.cwd === url.searchParams.get("cwd")).map((item) => ({ source: item.source, items: [structuredClone(item)] })), projects, diagnostics: [] }
      return Response.json(list)
    }
    const id = url.pathname.split("/")[5]
    const found = skills.find((item) => item.id === id)
    if (!found) return Response.json({ detail: "Missing fixture" }, { status: 404 })
    if (method === "PATCH") {
      if (failToggle) return Response.json({ detail: "Fixture save failed" }, { status: 500 })
      found.enabled = (JSON.parse(String(init?.body)) as { enabled: boolean }).enabled
      return Response.json(found)
    }
    if (url.pathname.endsWith("/file")) return Response.json({ content: files[url.searchParams.get("path") as keyof typeof files] })
    return Response.json(found)
  }
  try {
    root.render(null)
    await until(() => !host.firstChild, "reset previous run")
    for (const item of skills) item.enabled = true
    await i18n.changeLanguage("en")
    root.render(<ResourceBrowser kind="skills" harness="claude" />)
    await until(() => row("global-skill"), "initial list")
    if (mobile) {
      check("mobile uses a single pane", !host.querySelector('[data-slot="resizable-panel"]'))
      row("global-skill").click()
      await until(() => row("SKILL.md"), "mobile file tree")
      check("mobile expands the skill before opening a file", !host.querySelector("article"))
      row("SKILL.md").click()
      await until(() => host.querySelector("article"), "mobile preview")
      check("mobile provides the two file modes", host.querySelectorAll('[role="tab"]').length === 2)
      Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.includes("Back to list"))!.click()
      await until(() => row("global-skill"), "mobile back")
      check("mobile returns to the resource list", !host.querySelector("article"))
      output.textContent = `${checks.join("\n")}\n${checks.length} checks passed`
      return
    }
    const searchButton = () => host.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("resources.search")}"]`)!
    const groupButtons = () => Array.from(host.querySelectorAll<HTMLButtonElement>('h2 [data-slot="collapsible-trigger"]'))
    check("project filter is removed and all project groups are shown", !host.querySelector('[role="combobox"]') && groupButtons().length === 3)
    check("only global group starts expanded", groupButtons().map((item) => item.getAttribute("aria-expanded")).join() === "true,false,false")
    check("collapsed project trees are not mounted", !host.textContent?.includes("alpha-skill"))
    const panels = host.querySelectorAll<HTMLElement>('[data-slot="resizable-panel"]')
    check("initial pane widths are one-third and two-thirds", Math.abs(panels[0].getBoundingClientRect().width / panels[1].getBoundingClientRect().width - 0.5) < 0.01)
    const headerHeight = searchButton().parentElement!.parentElement!.getBoundingClientRect().height
    const beforeSearch = requests.length
    searchButton().click()
    await until(() => host.querySelector("input") === document.activeElement, "search focus")
    const input = host.querySelector<HTMLInputElement>("input")!
    check("sidebar-style search replaces the header without changing its height", input.parentElement!.parentElement!.getBoundingClientRect().height === headerHeight)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "beta")
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await until(() => groupButtons().length === 1, "filtered resources")
    check("search filters resources across projects without another request", groupButtons()[0].textContent?.includes("beta") && requests.length === beforeSearch)
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    await until(() => groupButtons().length === 3 && document.activeElement === searchButton() && !host.querySelector("input"), "search escape")
    check("Escape clears search and restores trigger focus", !host.querySelector("input"))
    check("skill root hides only the disclosure arrow", !row("global-skill").querySelector('.lucide-chevron-down'))
    groupButtons()[1].click()
    await until(() => row("alpha-skill"), "project expands")
    check("project group expands independently", groupButtons()[2].getAttribute("aria-expanded") === "false")
    row("global-skill").click()
    await until(() => host.querySelector("article"), "Markdown preview")
    check("default Markdown preview omits frontmatter", host.querySelector("article")?.textContent?.includes("Preview heading") && !host.querySelector("article")?.textContent?.includes("description: Fixture"))
    const header = host.querySelector<HTMLElement>("[data-skill-header]")!
    check("detail header shows the description and a 16px title", header.querySelector("p")?.textContent === "Fixture" && getComputedStyle(header.querySelector("h2")!).fontSize === "16px")
    check("detail header omits its icon, source metadata and permission text", !header.querySelector(".lucide-scroll-text") && !header.textContent?.includes("directory") && !header.textContent?.includes("skillOverrides") && !header.textContent?.includes("/fixture"))
    const headerSize = header.getBoundingClientRect().height
    const toolbar = host.querySelector<HTMLElement>("[data-skill-file-toolbar]")!
    check("toolbar displays the absolute file path without a dropdown", toolbar.querySelector("p")?.textContent === "/fixture/skills/global-skill/SKILL.md" && !host.querySelector('[role="combobox"]'))
    check("file tabs are compact and aligned after the copy action", toolbar.querySelector('[role="tablist"]')!.getBoundingClientRect().height === 28 && toolbar.querySelector('button')?.getAttribute("aria-label") === "Copy content")
    const copyButton = () => toolbar.querySelector<HTMLButtonElement>('button[aria-label="Copy content"]')!
    copyButton().click()
    await until(() => copiedText === markdown && copyButton().title === "Copied", "copy content")
    check("copy uses complete file content including frontmatter", copiedText.startsWith("---\n") && copyButton().title === "Copied")
    const actionButtons = [searchButton(), host.querySelector<HTMLElement>('a[aria-label="Download"]')!, host.querySelector<HTMLElement>('button[aria-label="Delete"]')!]
    check("list and detail actions share the compact icon size", actionButtons.every((button) => button.getBoundingClientRect().width === 20 && button.querySelector("svg")!.getBoundingClientRect().width === 14))
    const article = host.querySelector("article")!
    const pane = activePanel(); pane.scrollTop = 350
    const oldScroll = pane.scrollTop
    const switchButton = () => host.querySelector<HTMLButtonElement>('[role="switch"]')!
    const loadingText = i18n.t("resources.loading")
    let flashed = false
    const observer = new MutationObserver(() => { if (!article.isConnected || host.textContent?.includes(loadingText)) flashed = true })
    observer.observe(host, { subtree: true, childList: true })
    const beforeToggle = requests.length
    switchButton().click()
    await until(() => switchButton().getAttribute("aria-checked") === "false" && !switchButton().disabled, "disable skill")
    observer.disconnect()
    check("disabling preserves preview DOM and scroll without loading flashes", !flashed && host.querySelector("article") === article && pane.scrollTop === oldScroll)
    check("disabled pill is 16px tall and does not change header height", header.querySelector('[data-slot="badge"]')!.getBoundingClientRect().height === 16 && header.getBoundingClientRect().height === headerSize)
    check("toggle updates status without refetching the selected detail", !requests.slice(beforeToggle).some((entry) => entry.method === "GET" && entry.path.startsWith("/api/sandbox/resource/skills/global-skill?")))
    switchButton().click()
    await until(() => switchButton().getAttribute("aria-checked") === "true" && !switchButton().disabled, "enable skill")
    check("enabling preserves preview DOM", host.querySelector("article") === article)
    failToggle = true; switchButton().click()
    await until(() => host.textContent?.includes("Fixture save failed"), "failed toggle")
    check("failed save retains enabled state and preview", switchButton().getAttribute("aria-checked") === "true" && host.querySelector("article") === article)
    failToggle = false
    tab("source").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    await until(() => activePanel()?.textContent?.includes("description: Fixture"), "source mode")
    check("source includes frontmatter and line numbers without syntax highlighting", activePanel().querySelector('[data-highlighted="true"]') === null && activePanel().querySelector('[aria-hidden="true"]')?.textContent === "1")
    row("script.py").click()
    await until(() => activePanel()?.textContent?.includes('print("hello")'), "Python source")
    check("toolbar path follows the selected file", toolbar.querySelector("p")?.textContent === "/fixture/skills/global-skill/script.py")
    check("source mode persists across text files", tab("source").getAttribute("data-state") === "active" && !activePanel().querySelector('[data-language]'))
    const sourcePane = activePanel()
    switchButton().click()
    await until(() => switchButton().getAttribute("aria-checked") === "false" && !switchButton().disabled, "toggle while viewing Python source")
    check("toggle preserves the selected file and source tab", activePanel() === sourcePane && activePanel().textContent?.includes('print("hello")') && tab("source").getAttribute("aria-selected") === "true")
    tab("preview").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    await until(() => activePanel()?.querySelector('[data-highlighted="true"]'), "Python highlighting")
    check("text preview uses extension-based language and numbered syntax", activePanel().querySelector('[data-language="python"]') && activePanel().querySelector('[aria-hidden="true"]')?.textContent === "1")
    row("notes.unknown").click()
    await until(() => activePanel()?.textContent?.includes("plain file"), "unknown text")
    check("unknown text extensions retain numbered plain text", !activePanel().querySelector('[data-language]') && activePanel().querySelector('[aria-hidden="true"]')?.textContent === "1")
    row("image.PNG").click()
    await until(() => activePanel()?.querySelector('img[alt="image.PNG"]'), "image preview")
    check("image preview uses asset endpoint and disables source", activePanel().querySelector('img')?.getAttribute("src")?.includes("/asset?") && tab("source").disabled)
    check("binary image never goes through text loading", !requests.some((entry) => entry.path.includes("/file?") && entry.path.includes("image.PNG")))
    row("archive.zip").click()
    await until(() => activePanel()?.textContent?.includes("Preview is unavailable"), "unsupported binary")
    check("unsupported binary has an explicit state without a text request", !requests.some((entry) => entry.path.includes("/file?") && entry.path.includes("archive.zip")))
    row("SKILL.md").click()
    await until(() => host.querySelector("article"), "return to Markdown")
    groupButtons()[0].click()
    await until(() => groupButtons()[0].getAttribute("aria-expanded") === "false", "global collapse")
    groupButtons()[0].click()
    await until(() => row("SKILL.md"), "global re-expansion")
    check("group collapse retains expanded skill tree state", row("global-skill").getAttribute("aria-expanded") === "true")
    const frame = document.createElement("iframe")
    frame.title = "Mobile skill browser checks"
    frame.style.cssText = "width:390px;height:760px;border:0"
    frame.src = "./skill-browser.html?mobile=1"
    host.after(frame)
    await new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }))
    frame.contentDocument!.querySelector<HTMLButtonElement>("#run")!.click()
    await until(() => /checks passed|FAIL/.test(frame.contentDocument!.querySelector("#results")!.textContent ?? ""), "mobile checks")
    const mobileResult = frame.contentDocument!.querySelector("#results")!.textContent ?? ""
    check("mobile list, file modes and back navigation pass", mobileResult.includes("4 checks passed"))
    frame.remove()
    output.textContent = `${checks.join("\n")}\n${checks.length} checks passed`
  } catch (error) { output.textContent = `${checks.join("\n")}\nFAIL ${error instanceof Error ? error.stack : String(error)}` }
  finally { window.fetch = originalFetch; if (originalClipboard) Object.defineProperty(navigator.clipboard, "writeText", originalClipboard); else Reflect.deleteProperty(navigator.clipboard, "writeText"); button.disabled = false }
})
