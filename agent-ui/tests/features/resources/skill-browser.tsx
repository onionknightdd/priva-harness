import * as React from "react"
import { createRoot } from "react-dom/client"
import i18n from "../../../src/i18n"
import "../../../src/index.css"
import { ResourceBrowser } from "../../../src/features/resources/resource-page"
import type { ResourceList, ResourceSource, SkillDetail } from "../../../src/features/resources/resource-api"

const host = document.querySelector<HTMLDivElement>("#page")!
const output = document.querySelector<HTMLPreElement>("#results")!
const root = createRoot(host)
const params = new URLSearchParams(location.search)
const mobile = params.has("mobile")
const reducedMotion = params.has("reduced-motion")
document.documentElement.classList.toggle("dark", params.has("dark"))
if (reducedMotion) {
  const matchMedia = window.matchMedia.bind(window)
  window.matchMedia = (media) => media.startsWith("(prefers-reduced-motion")
    ? Object.assign(new EventTarget(), { matches: true, media, onchange: null, addListener() {}, removeListener() {} }) as MediaQueryList
    : matchMedia(media)
}
if (mobile) host.style.width = "100%"
const source: ResourceSource = { id: "global", harness: "claude", scope: "global", origin: "directory", label: "Global", path: "/fixture/skills", cwd: null, writable: true, canAdd: true }
const projects = ["/fixture/alpha", "/fixture/beta"]
const markdown = "---\nname: global-skill\ndescription: Fixture\n---\n# Preview heading\n\n" + "Paragraph to scroll.\n\n".repeat(100)
const files = { "SKILL.md": markdown, "guide.markdown": "# Guide\n\n**Bold** and `inline code`.\n", "script.py": 'print("hello")\nvalue = 42\n', "notes.unknown": "plain file\nsecond line", "diagram.svg": '<svg xmlns="http://www.w3.org/2000/svg" />' }
function skill(name: string, origin: ResourceSource): SkillDetail {
  return { id: name, name, description: "Fixture", sourceId: origin.id, source: origin, path: `${origin.path}/${name}`, filePath: `${origin.path}/${name}/SKILL.md`, enabled: true, canToggle: true, canDelete: true, toggleDescription: "", content: markdown, files: [...Object.entries(files).map(([path, text]) => ({ path, size: text.length })), { path: "image.PNG", size: 100 }, { path: "archive.zip", size: 100 }] }
}
const skills = [skill("global-skill", source), skill("other-skill", source), ...projects.map((cwd) => skill(cwd.split("/").at(-1)! + "-skill", { ...source, id: cwd, cwd, scope: "project", path: `${cwd}/.claude/skills` }))]

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
  let actionFrame = 0
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
    const searchButton = () => host.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("resources.searchSkills")}"]`)!
    if (mobile) {
      check("mobile uses a single pane", !host.querySelector('[data-slot="resizable-panel"]'))
      searchButton().click()
      await until(() => host.querySelector("input") === document.activeElement, "mobile search focus")
      await wait(500)
      const searchInput = host.querySelector<HTMLInputElement>("input")!
      check("mobile search stays right of the title and within the header", host.querySelector("h1")!.getBoundingClientRect().right < searchInput.getBoundingClientRect().left && host.scrollWidth <= host.clientWidth)
      searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      await until(() => !host.querySelector("input"), "mobile search close")
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
    const listHeader = host.querySelector<HTMLElement>("[data-skill-list-header]")!
    check("English skill header includes localized guidance", listHeader.querySelector("h1")?.textContent === "Agent Skills" && listHeader.querySelector("p")?.textContent === "Skills are instructions that extend an Agent's capabilities.")
    await i18n.changeLanguage("zh-CN")
    await until(() => listHeader.querySelector("h1")?.textContent === "技能", "Chinese skill title")
    check("Chinese 18px skill title and 12px guidance follow the language setting", listHeader.querySelector("p")?.textContent === "技能是用于扩展 Agent 能力的指令。" && getComputedStyle(listHeader.querySelector("h1")!).fontSize === "18px" && getComputedStyle(listHeader.querySelector("p")!).fontSize === "12px")
    await i18n.changeLanguage("en")
    await until(() => listHeader.querySelector("h1")?.textContent === "Agent Skills", "English skill title")
    const groupButtons = () => Array.from(host.querySelectorAll<HTMLButtonElement>('h2 [data-slot="collapsible-trigger"]'))
    check("project filter is removed and all project groups are shown", !host.querySelector('[role="combobox"]') && groupButtons().length === 3)
    check("only global group starts expanded", groupButtons().map((item) => item.getAttribute("aria-expanded")).join() === "true,false,false")
    check("group disclosure icons follow their titles and precede the separators", groupButtons().every((button) => {
      const title = button.querySelector("span")!
      const icon = button.querySelector("svg")!
      const separator = button.querySelector('[data-slot="separator"]')!
      return title.getBoundingClientRect().right <= icon.getBoundingClientRect().left && icon.getBoundingClientRect().right <= separator.getBoundingClientRect().left
    }))
    check("search is the first header action", listHeader.querySelector("button") === searchButton())
    check("collapsed skill items have an additional 2px gap", Math.abs(row("other-skill").getBoundingClientRect().top - row("global-skill").getBoundingClientRect().bottom - 2) < 0.1)
    check("collapsed project trees are not mounted", !host.textContent?.includes("alpha-skill"))
    const panels = host.querySelectorAll<HTMLElement>('[data-slot="resizable-panel"]')
    check("initial pane widths are one-third and two-thirds", Math.abs(panels[0].getBoundingClientRect().width / panels[1].getBoundingClientRect().width - 0.5) < 0.01)
    const headerHeight = searchButton().parentElement!.parentElement!.getBoundingClientRect().height
    const listHeaderHeight = listHeader.getBoundingClientRect().height
    const skillTitle = listHeader.querySelector("h1")!
    const titleBounds = skillTitle.getBoundingClientRect()
    const refreshButton = listHeader.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!
    const uploadButton = listHeader.querySelector<HTMLButtonElement>('button[aria-label="Upload skill"]')!
    const searchIconStart = searchButton().querySelector("svg")!.getBoundingClientRect().left
    const beforeSearch = requests.length
    searchButton().click()
    await until(() => host.querySelector("input") === document.activeElement, "search focus")
    const input = host.querySelector<HTMLInputElement>("input")!
    check("search placeholder is specific to skills", input.placeholder === "Search skills")
    check("sidebar-style search expands without changing the row height", input.parentElement!.parentElement!.getBoundingClientRect().height === headerHeight)
    check("search keeps the guidance visible and the full header height stable", listHeader.querySelector("p")?.textContent === i18n.t("resources.skillsHint") && listHeader.getBoundingClientRect().height === listHeaderHeight)
    const searchIcon = input.parentElement!.querySelector("svg")!
    const searchIconDuring = searchIcon.getBoundingClientRect().left
    await wait(500)
    const searchIconEnd = searchIcon.getBoundingClientRect().left
    check("expanded search stops right of the stable title", listHeader.querySelector("h1") === skillTitle && skillTitle.getBoundingClientRect().left === titleBounds.left && skillTitle.getBoundingClientRect().width === titleBounds.width && input.getBoundingClientRect().left >= titleBounds.right + 10)
    check("refresh and upload remain visible to the right of search", visible(refreshButton) && visible(uploadButton) && input.getBoundingClientRect().right <= refreshButton.getBoundingClientRect().left)
    check(reducedMotion ? "reduced motion positions the search icon immediately" : "search icon glides from the action into the input", reducedMotion
      ? Math.abs(searchIconDuring - searchIconEnd) < 1
      : searchIconDuring > searchIconEnd + 1 && searchIconDuring <= searchIconStart + 1)
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
    await wait(300)
    check("expanded skill items keep a 2px outer gap", Math.abs(row("other-skill").closest('[role="tree"]')!.getBoundingClientRect().top - row("global-skill").closest('[role="tree"]')!.getBoundingClientRect().bottom - 2) < 0.1)
    const fileLabel = row("script.py").querySelector<HTMLElement>('[data-slot="tree-item-label"]')!
    check("skill file rows halve vertical padding and spacing", getComputedStyle(fileLabel).paddingTop === "3px" && getComputedStyle(fileLabel).paddingBottom === "3px" && fileLabel.getBoundingClientRect().height === 26 && Math.abs(row("script.py").getBoundingClientRect().top - row("notes.unknown").getBoundingClientRect().bottom - 1) < 0.1)
    check("default Markdown preview omits frontmatter", host.querySelector("article")?.textContent?.includes("Preview heading") && !host.querySelector("article")?.textContent?.includes("description: Fixture"))
    const header = host.querySelector<HTMLElement>("[data-skill-header]")!
    check("detail header uses a 16px title and 12px description", header.querySelector("p")?.textContent === "Fixture" && getComputedStyle(header.querySelector("h2")!).fontSize === "16px" && getComputedStyle(header.querySelector("p")!).fontSize === "12px")
    check("detail header omits its icon, source metadata and permission text", !header.querySelector(".lucide-scroll-text") && !header.textContent?.includes("directory") && !header.textContent?.includes("skillOverrides") && !header.textContent?.includes("/fixture"))
    const headerSize = header.getBoundingClientRect().height
    const toolbar = host.querySelector<HTMLElement>("[data-skill-file-toolbar]")!
    check("toolbar displays the absolute file path without a dropdown", toolbar.querySelector("p")?.textContent === "/fixture/skills/global-skill/SKILL.md" && !host.querySelector('[role="combobox"]'))
    check("24px file tabs follow the copy action inside a 36px toolbar", toolbar.getBoundingClientRect().height === 36 && toolbar.querySelector('[role="tablist"]')!.getBoundingClientRect().height === 24 && toolbar.querySelector('button')?.getAttribute("aria-label") === "Copy content")
    check("tab buttons and text are vertically centered within the list", Array.from(toolbar.querySelectorAll<HTMLElement>('[role="tab"]')).every((button) => {
      const list = button.closest('[role="tablist"]')!.getBoundingClientRect()
      const rect = button.getBoundingClientRect()
      const text = document.createRange()
      text.selectNodeContents(button)
      const textRect = text.getBoundingClientRect()
      return rect.height === 20 && Math.abs(rect.top + rect.height / 2 - list.top - list.height / 2) < 1 && Math.abs(textRect.top + textRect.height / 2 - rect.top - rect.height / 2) <= 1
    }))
    const copyButton = () => toolbar.querySelector<HTMLButtonElement>('button[aria-label="Copy content"]')!
    const copyFeedback = () => toolbar.querySelector('[role="status"]')?.textContent
    copyButton().click()
    await until(() => copiedText === markdown && copyFeedback() === "Copied", "copy content")
    check("copy uses complete file content including frontmatter", copiedText.startsWith("---\n") && copyFeedback() === "Copied")
    const actionButtons = [searchButton(), host.querySelector<HTMLElement>('a[aria-label="Download"]')!, host.querySelector<HTMLElement>('button[aria-label="Delete"]')!]
    check("list and detail actions share the compact icon size", actionButtons.every((button) => button.getBoundingClientRect().width === 20 && button.querySelector("svg")!.getBoundingClientRect().width === 14))
    const article = host.querySelector("article")!
    const pane = activePanel(); pane.scrollTop = 350
    const oldScroll = pane.scrollTop
    const switchButton = () => host.querySelector<HTMLButtonElement>('[role="switch"]')!
    check("skill toggle is 15px tall with a matching 11px thumb", switchButton().getBoundingClientRect().height === 15 && switchButton().getBoundingClientRect().width === 24 && switchButton().querySelector('[data-slot="switch-thumb"]')!.getBoundingClientRect().height === 11)
    const stableActions = [switchButton(), ...actionButtons.slice(1)]
    const actionIcons = stableActions.flatMap((button) => Array.from(button.querySelectorAll("svg")))
    const watchActionOpacity = () => {
      let stable = true
      const sample = () => {
        stable &&= [...stableActions, ...actionIcons].every((node) => node.isConnected && getComputedStyle(node).opacity === "1")
        actionFrame = requestAnimationFrame(sample)
      }
      sample()
      return () => { cancelAnimationFrame(actionFrame); return stable }
    }
    const loadingText = i18n.t("resources.loading")
    let flashed = false
    const observer = new MutationObserver(() => { if (!article.isConnected || host.textContent?.includes(loadingText)) flashed = true })
    observer.observe(host, { subtree: true, childList: true })
    const beforeToggle = requests.length
    let actionsStayedStable = watchActionOpacity()
    switchButton().click()
    await until(() => switchButton().disabled, "pending disable")
    check("saving exposes busy state and blocks duplicate actions", switchButton().parentElement!.getAttribute("aria-busy") === "true" && (stableActions[2] as HTMLButtonElement).disabled)
    switchButton().click()
    await until(() => switchButton().getAttribute("aria-checked") === "false" && !switchButton().disabled, "disable skill")
    observer.disconnect()
    check("disabling preserves preview DOM and scroll without loading flashes", !flashed && host.querySelector("article") === article && pane.scrollTop === oldScroll)
    check("disabling keeps header actions and icons mounted at full opacity", actionsStayedStable())
    check("disabled pill is 16px tall and does not change header height", header.querySelector('[data-slot="badge"]')!.getBoundingClientRect().height === 16 && header.getBoundingClientRect().height === headerSize)
    check("toggle updates status without refetching the selected detail", !requests.slice(beforeToggle).some((entry) => entry.method === "GET" && entry.path.startsWith("/api/sandbox/resource/skills/global-skill?")))
    check("repeated clicks while saving send only one update", requests.slice(beforeToggle).filter((entry) => entry.method === "PATCH").length === 1)
    actionsStayedStable = watchActionOpacity()
    switchButton().click()
    await until(() => switchButton().getAttribute("aria-checked") === "true" && !switchButton().disabled, "enable skill")
    check("enabling preserves preview DOM", host.querySelector("article") === article)
    check("enabling keeps header actions and icons at full opacity", actionsStayedStable())
    actionsStayedStable = watchActionOpacity()
    failToggle = true; switchButton().click()
    await until(() => host.textContent?.includes("Fixture save failed"), "failed toggle")
    check("failed save retains enabled state and preview", switchButton().getAttribute("aria-checked") === "true" && host.querySelector("article") === article)
    check("failed save keeps header actions and icons at full opacity", actionsStayedStable())
    failToggle = false
    tab("source").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    await until(() => activePanel()?.textContent?.includes("description: Fixture"), "source mode")
    await until(() => activePanel()?.querySelector('[data-highlighted="true"]'), "Markdown source highlighting")
    check("Markdown source includes frontmatter, line numbers and syntax highlighting", activePanel().querySelector('[data-language="markdown"] code span[style]') && activePanel().textContent?.includes("# Preview heading") && !activePanel().querySelector("article") && activePanel().querySelector('[aria-hidden="true"]')?.textContent === "1")
    row("guide.markdown").click()
    await until(() => activePanel()?.textContent?.includes("# Guide") && activePanel()?.querySelector('[data-highlighted="true"]'), "Markdown file source highlighting")
    check("loaded .markdown files also show numbered highlighted source", activePanel().querySelector('[data-language="markdown"] code span[style]') && activePanel().textContent?.includes("**Bold**") && activePanel().querySelector('[aria-hidden="true"]')?.textContent === "1")
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
    frame.src = `./skill-browser.html?mobile=1${reducedMotion ? "&reduced-motion=1" : ""}${params.has("dark") ? "&dark=1" : ""}`
    host.after(frame)
    await new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }))
    frame.contentDocument!.querySelector<HTMLButtonElement>("#run")!.click()
    await until(() => /checks passed|FAIL/.test(frame.contentDocument!.querySelector("#results")!.textContent ?? ""), "mobile checks")
    const mobileResult = frame.contentDocument!.querySelector("#results")!.textContent ?? ""
    check("mobile search, list, file modes and back navigation pass", mobileResult.includes("5 checks passed"))
    frame.remove()
    await i18n.changeLanguage("zh-CN")
    await until(() => searchButton(), "Chinese search trigger")
    searchButton().click()
    await until(() => host.querySelector("input") === document.activeElement, "Chinese search focus")
    check("Chinese search placeholder reads 搜索技能", host.querySelector<HTMLInputElement>("input")!.placeholder === "搜索技能")
    output.textContent = `${checks.join("\n")}\n${checks.length} checks passed`
  } catch (error) { output.textContent = `${checks.join("\n")}\nFAIL ${error instanceof Error ? error.stack : String(error)}` }
  finally { cancelAnimationFrame(actionFrame); window.fetch = originalFetch; if (originalClipboard) Object.defineProperty(navigator.clipboard, "writeText", originalClipboard); else Reflect.deleteProperty(navigator.clipboard, "writeText"); button.disabled = false }
})
