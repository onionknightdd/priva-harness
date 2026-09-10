import * as React from "react"
import { createRoot } from "react-dom/client"
import i18n from "../../../src/i18n"
import "../../../src/index.css"
import { ResourceBrowser } from "../../../src/features/resources/resource-page"
import type { McpCapabilities, McpDetail, ResourceList, ResourceSource } from "../../../src/features/resources/resource-api"

const host = document.querySelector<HTMLDivElement>("#page")!
const output = document.querySelector<HTMLPreElement>("#results")!
const root = createRoot(host)
const params = new URLSearchParams(location.search)
const mobile = params.has("mobile")
document.documentElement.classList.toggle("dark", params.has("dark"))
if (params.has("reduced-motion")) {
  const matchMedia = window.matchMedia.bind(window)
  window.matchMedia = (media) => media.startsWith("(prefers-reduced-motion")
    ? Object.assign(new EventTarget(), { matches: true, media, onchange: null, addListener() {}, removeListener() {} }) as MediaQueryList
    : matchMedia(media)
}
if (mobile) host.style.width = "100%"

const source: ResourceSource = { id: "global", harness: "claude", scope: "global", origin: "settings", label: "Global MCP", path: "/fixture/agent/.claude.json", cwd: null, writable: true, canAdd: true }
const projects = ["/fixture/alpha", "/fixture/beta"]
function server(name: string, origin: ResourceSource, enabled = true): McpDetail {
  const definition = { type: "http", url: `https://example.invalid/${name}/mcp` }
  return { id: name, name, sourceId: origin.id, source: origin, enabled, transport: "http", target: definition.url, effective: null, override: false, headerCount: 0, definition, effectiveDefinition: definition }
}
const servers = [
  server("filesystem", source), server("documentation", source), server("disabled-server", { ...source, writable: false }, false),
  ...projects.map((cwd) => server(cwd.split("/").at(-1)! + "-server", { ...source, id: cwd, cwd, scope: "project", path: `${cwd}/.mcp.json` })),
]
const capabilities: McpCapabilities = {
  tools: Array.from({ length: 16 }, (_, index) => ({ name: index === 0 ? "read_file" : `inspect_resource_${index}`, description: "Read project resources and inspect their contents.\nReturns structured data for the current workspace.", inputSchema: { type: "object", properties: { path: { type: "string" } } } })),
  prompts: [], resources: [{ name: "workspace", uri: "fixture://workspace", description: "Workspace metadata" }], testedAt: "2026-09-10T00:00:00Z",
}
const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(ready: () => unknown, message: string) {
  const start = performance.now()
  while (!ready()) { if (performance.now() - start > 15000) throw new Error(`Timed out: ${message}`); await wait() }
}
const visible = (element: Element) => element.getClientRects().length > 0
const row = (id: string) => host.querySelector<HTMLButtonElement>(`[data-mcp-item="${id}"]`)!
const activePanel = () => Array.from(host.querySelectorAll<HTMLElement>('[role="tabpanel"][data-state="active"]')).find(visible)!
const findButton = (label: string, scope: ParentNode = host) => Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((button) => visible(button) && (button.getAttribute("aria-label") === label || button.textContent === label))!
const selectTab = (key: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => visible(button) && button.textContent?.startsWith(i18n.t(`resources.${key}`)))!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
const requests: { method: string; path: string; cwd: string | null }[] = []
let failTest = false
let copiedText = ""
const originalFetch = window.fetch
// Every resource request stays in this fixture, including after the checks.
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href)
  if (!url.pathname.startsWith("/api/sandbox/resource/")) return originalFetch(input, init)
  const method = init?.method ?? "GET"
  requests.push({ method, path: url.pathname, cwd: url.searchParams.get("cwd") })
  await wait(120)
  if (url.pathname === "/api/sandbox/resource/mcp" && method === "GET") {
    const list: ResourceList = { groups: servers.map((item) => ({ source: item.source, items: [structuredClone(item)] })), projects, diagnostics: [] }
    return Response.json(list)
  }
  const found = servers.find((item) => item.id === url.pathname.split("/")[5])
  if (!found) return Response.json({ detail: "Unknown fixture request" }, { status: 404 })
  if (url.pathname.endsWith("/capabilities")) return failTest ? Response.json({ detail: "Fixture connection failed" }, { status: 500 }) : Response.json(capabilities)
  if (method !== "GET") return Response.json({ detail: "Fixture does not write real configuration" }, { status: 403 })
  return Response.json(found)
}
Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: async (text: string) => { copiedText = text } })

document.querySelector<HTMLButtonElement>("#run")!.addEventListener("click", async (event) => {
  const button = event.currentTarget as HTMLButtonElement
  button.disabled = true
  output.textContent = "Running…"
  const checks: string[] = []
  const check = (name: string, condition: unknown) => { if (!condition) throw new Error(name); checks.push(`PASS ${name}`) }
  try {
    root.render(null)
    await until(() => !host.firstChild, "reset")
    requests.length = 0; failTest = false
    await i18n.changeLanguage("en")
    root.render(<ResourceBrowser kind="mcp" harness="claude" />)
    await until(() => row("filesystem"), "initial list")
    const header = host.querySelector<HTMLElement>("[data-mcp-list-header]")!
    check("all project groups are available without a scope selector", !host.querySelector('[role="combobox"]') && host.querySelectorAll('h2 [aria-expanded]').length === 3)
    check("only global MCP starts expanded", Array.from(host.querySelectorAll('h2 [aria-expanded]')).map((item) => item.getAttribute("aria-expanded")).join() === "true,false,false")
    findButton(i18n.t("resources.searchMcp")).click()
    await until(() => header.querySelector("input") === document.activeElement, "search focus")
    await wait(500)
    const input = header.querySelector<HTMLInputElement>("input")!
    check("search leaves the title and other actions visible", header.querySelector("h1")!.getBoundingClientRect().right < input.getBoundingClientRect().left && visible(findButton(i18n.t("resources.add"))) && host.scrollWidth <= host.clientWidth)
    const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    setInput.call(input, "does-not-exist"); input.dispatchEvent(new Event("input", { bubbles: true }))
    await until(() => host.textContent?.includes(i18n.t("resources.noMatches")), "empty search")
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    await until(() => !header.querySelector("input") && row("filesystem"), "search reset")
    check("Escape clears the search and restores focus", document.activeElement === findButton(i18n.t("resources.searchMcp")))
    if (!mobile) {
      const panels = host.querySelectorAll<HTMLElement>('[data-slot="resizable-panel"]')
      check("desktop starts at the approved one-to-two split", Math.abs(panels[0].clientWidth / (panels[0].clientWidth + panels[1].clientWidth) - 1 / 3) < 0.015)
    }
    row("filesystem").click()
    await until(() => host.querySelector("[data-mcp-header]"), "service details")
    check("details show the service target with the compact name hierarchy", host.querySelector("[data-mcp-header] p")?.textContent === servers[0].target && getComputedStyle(host.querySelector("[data-mcp-header] h2")!).fontSize === "16px")
    if (mobile) {
      check("mobile toolbar fits the viewport and provides all four tabs", !host.querySelector('[data-slot="resizable-panel"]') && host.scrollWidth <= host.clientWidth && host.querySelectorAll('[role="tab"]').length === 4)
      selectTab("configuration")
      await until(() => activePanel()?.textContent?.includes("example.invalid"), "mobile configuration")
      findButton(i18n.t("resources.back")).click()
      await until(() => row("filesystem"), "mobile back")
      check("mobile returns to the service list", !host.querySelector("[data-mcp-header]"))
      output.textContent = `${checks.join("\n")}\n${checks.length} checks passed`
      return
    }
    const toolbar = host.querySelector<HTMLElement>("[data-mcp-toolbar]")!
    check("desktop toolbar remains compact and shows the source path", toolbar.getBoundingClientRect().height === 36 && toolbar.querySelector("p")?.textContent === source.path && toolbar.querySelector('[role="tablist"]')!.getBoundingClientRect().height === 24)
    findButton(i18n.t("resources.test")).click()
    await until(() => activePanel()?.querySelector("h3"), "connection results")
    const pane = activePanel()
    const firstTool = pane.querySelector("h3")!
    pane.scrollTop = 180
    const oldScroll = pane.scrollTop
    const beforeRetry = requests.length
    const testButton = host.querySelector<HTMLButtonElement>("[data-mcp-connection] button")!
    testButton.click()
    await until(() => testButton.disabled, "pending connection")
    testButton.click()
    check("retesting preserves tool content, scroll and button opacity", firstTool.isConnected && activePanel() === pane && pane.scrollTop === oldScroll && getComputedStyle(testButton).opacity === "1")
    await until(() => !testButton.disabled, "retest success")
    check("pending connection prevents duplicate probes", requests.slice(beforeRetry).filter((request) => request.path.endsWith("/capabilities")).length === 1)
    failTest = true; testButton.click()
    await until(() => host.textContent?.includes("Fixture connection failed"), "failed connection")
    check("failed retest retains the last result and reports failure", firstTool.isConnected && pane.scrollTop === oldScroll && host.querySelector("[data-mcp-connection]")?.textContent?.includes(i18n.t("resources.testFailed")))
    failTest = false; testButton.click()
    await until(() => !testButton.disabled && !host.textContent?.includes("Fixture connection failed"), "connection recovery")
    selectTab("prompts")
    await until(() => activePanel()?.textContent?.includes(i18n.t("resources.noCapabilities")), "empty prompts")
    check("empty capability categories have an explicit empty state", !activePanel().querySelector("h3"))
    selectTab("tools")
    await until(() => activePanel() === pane, "restore tools")
    check("switching tabs preserves the tool list and its scroll", pane.querySelector("h3") === firstTool && pane.scrollTop === oldScroll)
    selectTab("configuration")
    await until(() => activePanel()?.textContent?.includes("example.invalid"), "configuration")
    findButton(i18n.t("filePreview.copy"), toolbar).click()
    await until(() => copiedText.includes("example.invalid"), "copy configuration")
    check("toolbar copies the selected configuration", copiedText === JSON.stringify(servers[0].definition, null, 2))
    const configPane = activePanel()
    const beforeSwitch = requests.length
    row("documentation").click()
    await until(() => Array.from(host.querySelectorAll("[data-mcp-header] h2")).some((item) => visible(item) && item.textContent === "documentation"), "second service")
    row("filesystem").click()
    await until(() => activePanel() === configPane, "cached service")
    check("returning to a service restores its active tab without a detail request", !requests.slice(beforeSwitch).some((request) => request.path.endsWith("/mcp/filesystem")))
    selectTab("tools")
    await until(() => activePanel() === pane, "cached results")
    check("returning to a service preserves connection results and scroll", pane.querySelector("h3") === firstTool && pane.scrollTop === oldScroll)
    row("disabled-server").click()
    await until(() => Array.from(host.querySelectorAll("[data-mcp-header] h2")).some((item) => visible(item) && item.textContent === "disabled-server"), "disabled service")
    const disabledHeader = Array.from(host.querySelectorAll<HTMLElement>("[data-mcp-header]")).find(visible)!
    check("read-only and disabled services retain their action restrictions", findButton(i18n.t("resources.edit"), disabledHeader).disabled && findButton(i18n.t("resources.delete"), disabledHeader).disabled && Array.from(host.querySelectorAll<HTMLButtonElement>("[data-mcp-connection] button")).find(visible)!.disabled)
    findButton("Project alpha").click()
    await until(() => row("alpha-server") && visible(row("alpha-server")), "project group")
    row("alpha-server").click()
    await until(() => Array.from(host.querySelectorAll("[data-mcp-header] h2")).some((item) => visible(item) && item.textContent === "alpha-server"), "project service")
    Array.from(host.querySelectorAll<HTMLButtonElement>("[data-mcp-connection] button")).find(visible)!.click()
    await until(() => requests.some((request) => request.path.endsWith("/alpha-server/capabilities")), "project probe")
    check("project probes use the selected server's own working directory", requests.find((request) => request.path.endsWith("/alpha-server/capabilities"))?.cwd === projects[0])
    check("detail retention is bounded to three services", host.querySelectorAll("[data-mcp-header]").length === 3)
    const frame = document.createElement("iframe")
    frame.style.cssText = "position:fixed;inset:0 auto auto 0;width:390px;height:760px;border:0;background:white;z-index:9999"
    frame.src = `/tests/features/resources/mcp-browser.html?mobile=1&${params.toString()}`
    document.body.append(frame)
    try {
      await new Promise<void>((resolve) => { frame.onload = () => resolve() })
      await until(() => frame.contentDocument?.querySelector("#run"), "mobile fixture")
      frame.contentDocument!.querySelector<HTMLButtonElement>("#run")!.click()
      await until(() => /checks passed|FAIL/.test(frame.contentDocument!.querySelector("#results")!.textContent ?? ""), "mobile checks")
      check("390px mobile search, tabs and back navigation pass", frame.contentDocument!.querySelector("#results")!.textContent?.includes("7 checks passed"))
    } finally { frame.remove() }
    await i18n.changeLanguage("zh-CN")
    await until(() => header.querySelector("h1")?.textContent === "MCP 服务", "Chinese header")
    check("Chinese header uses the shared typography and guidance", getComputedStyle(header.querySelector("h1")!).fontSize === "18px" && getComputedStyle(header.querySelector("p")!).fontSize === "12px" && header.querySelector("p")?.textContent === "MCP 服务用于连接 Agent 与外部工具和数据。")
    findButton(i18n.t("resources.searchMcp")).click()
    await until(() => header.querySelector("input"), "Chinese search")
    check("MCP search has its own localized placeholder", header.querySelector<HTMLInputElement>("input")!.placeholder === "搜索 MCP 服务")
    output.textContent = `${checks.join("\n")}\n${checks.length} checks passed`
  } catch (error) { output.textContent = `${checks.join("\n")}\nFAIL ${error instanceof Error ? error.stack : String(error)}` }
  finally { button.disabled = false }
})
