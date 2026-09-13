import assert from "node:assert/strict"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"
import type { McpCapabilities, McpDetail, ResourceGroup } from "../../../src/features/resources/resource-api.ts"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLTextAreaElement", "Element", "Node", "NodeFilter", "DocumentFragment", "ShadowRoot", "SVGElement", "Event", "InputEvent", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "DOMRect", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})
dom.window.matchMedia = (query) => ({ matches: true, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, onchange: null })
dom.window.HTMLElement.prototype.getAnimations = () => []
dom.window.HTMLElement.prototype.scrollIntoView = () => {}
after(() => dom.window.close())

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { I18nextProvider, initReactI18next } = await import("react-i18next")
const i18n = (await import("i18next")).default.createInstance()
const { resourcesEn, resourcesZh } = await import("../../../src/i18n/locales/resources.ts")
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: { resources: resourcesEn } }, "zh-CN": { translation: { resources: resourcesZh } } } })
const { ResourceCreateDialog, McpEditor } = await import("../../../src/features/resources/resource-forms.tsx")

const groups: ResourceGroup[] = [{ source: { id: "global", harness: "claude", scope: "global", origin: "settings", label: "Global MCP", path: "/fixture/.claude.json", cwd: null, writable: true, canAdd: true }, items: [] }]
const projects = ["/workspace/alpha", "/workspace/beta", "/workspace/client/app", "/workspace/team/app"]
const capabilities: McpCapabilities = { tools: [{ name: "read_file" }, { name: "write_file" }], prompts: [{ name: "review" }], resources: [{ name: "docs", uri: "project://docs" }, { uri: "project://readme" }], serverVersion: "1.2.3", testedAt: new Date(0).toISOString() }
let testReply: () => Response | Promise<Response> = () => Response.json(capabilities)
const requests: { url: URL; body: Record<string, unknown>; method?: string }[] = []
const originalFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  requests.push({ url: new URL(String(input), "http://localhost"), body: JSON.parse(String(init?.body)), method: init?.method })
  if (requests.at(-1)!.url.pathname.endsWith("/mcp/validate")) return await testReply()
  return Response.json({ id: "saved-server" })
}
after(() => { globalThis.fetch = originalFetch })

const field = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === text || button.getAttribute("aria-label") === text)!
const inventory = () => document.querySelector<HTMLElement>('[data-mcp-probe-result]')
const click = async (element: HTMLElement) => {
  assert.ok(element)
  await act(async () => {
    if (element instanceof HTMLButtonElement) element.focus()
    element.click()
  })
}
const type = async (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  assert.ok(element)
  await act(async () => {
    Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
const openCombobox = async (label: string) => {
  const input = field(label)
  assert.equal(input.getAttribute("role"), "combobox")
  await act(async () => {
    input.focus()
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
  })
  return input
}
const select = async (label: string, text: string, selectedText = text, search = text) => {
  const input = await openCombobox(label)
  await type(input, search)
  assert.equal(input.value, search, "Form updates must preserve the current combobox search")
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.getAttribute("aria-label") === text || option.textContent === text)
  assert.ok(option, `Missing combobox option: ${text}; input: ${input.value}; expanded: ${input.getAttribute("aria-expanded")}; rendered: ${document.querySelector('[role="listbox"]')?.textContent}`)
  await click(option)
  assert.equal(input.value, selectedText)
}
async function mount(kind: "skills" | "mcp", detail?: McpDetail, cwd?: string) {
  requests.length = 0
  testReply = () => Response.json(capabilities)
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  let saved: { id: string; cwd?: string } | undefined
  const props = { query: { harness: "claude" as const, cwd }, projects, open: true, onOpenChange() {}, onSaved: (id: string, cwd?: string) => { saved = { id, cwd } } }
  await act(async () => root.render(<I18nextProvider i18n={i18n}>{detail ? <McpEditor {...props} detail={detail} /> : <ResourceCreateDialog {...props} kind={kind} />}</I18nextProvider>))
  return { saved: () => saved, async close() { await act(async () => root.unmount()); host.remove() } }
}

test("Skill effective scope groups global and project options and preserves custom paths", async () => {
  const form = await mount("skills")
  try {
    await openCombobox("Effective scope")
    assert.deepEqual([...document.querySelectorAll('[data-slot="combobox-label"]')].map((label) => label.textContent), ["Apply globally", "Specific project"])
    await select("Effective scope", "beta /workspace/beta", "beta", "beta")
    assert.equal(field("Project directory"), null)
    assert.ok(field("Effective scope").parentElement!.textContent!.includes(projects[1]))
    await select("Effective scope", "Other project…")
    await select("Project directory", "alpha /workspace/alpha", projects[0], "alpha")
    await type(field("Project directory"), "/workspace/new-project")
    await act(async () => field("Project directory").blur())
    assert.equal(field("Project directory").value, "/workspace/new-project")
    await select("Effective scope", "All projects")
    assert.equal(field("Project directory"), null)
    await select("Effective scope", "Other project…")
    assert.equal(field("Project directory").value, "/workspace/new-project")
    assert.equal(requests.length, 0)
  } finally { await form.close() }
})

test("MCP combobox selections and key/value rows reach test and save requests", async () => {
  const form = await mount("mcp")
  try {
    await select("Effective scope", "alpha /workspace/alpha", "alpha", projects[0])
    await type(field("Name"), "example")
    await select("Transport", "SSE")
    await type(field("Server URL"), "https://example.invalid/mcp")
    await click(button("Add header"))
    await type(field("Header 1 key"), "Authorization")
    await type(field("Header 1 value"), "Bearer ${TOKEN}")
    await click(button("Add header"))
    await type(field("Header 2 key"), "X-Project")
    await type(field("Header 2 value"), "alpha")
    await click(button("Test connection"))
    assert.equal(requests.at(-1)!.url.searchParams.get("cwd"), projects[0])
    assert.deepEqual(requests.at(-1)!.body.definition, { type: "sse", url: "https://example.invalid/mcp", headers: { Authorization: "Bearer ${TOKEN}", "X-Project": "alpha" } })
    assert.match(inventory()!.closest('[role="status"]')!.textContent!, /MCP server test succeeded/)
    assert.match(inventory()!.textContent!, /Tools \(2\), Prompts \(1\), Resources \(2\)/)
    assert.ok(!inventory()!.textContent!.includes("read_file"))
    await click(button("Remove header 2"))
    assert.equal(inventory(), null)
    await click(button("Save"))
    assert.deepEqual(requests.at(-1)!.body, { name: "example", scope: "project", definition: { type: "sse", url: "https://example.invalid/mcp", headers: { Authorization: "Bearer ${TOKEN}" } } })
    assert.deepEqual(form.saved(), { id: "saved-server", cwd: projects[0] })
  } finally { await form.close() }
})

test("same-name projects remain distinct and save their full directories", async () => {
  const form = await mount("mcp")
  try {
    const input = await openCombobox("Effective scope")
    await type(input, "app")
    assert.deepEqual([...document.querySelectorAll('[role="option"]')].map((option) => option.getAttribute("aria-label")), ["app /workspace/client/app", "app /workspace/team/app"])
    await select("Effective scope", "app /workspace/team/app", "app", "/workspace/team")
    assert.equal(field("Project directory"), null)
    await type(field("Name"), "same-name-project")
    await type(field("Server URL"), "https://example.invalid/mcp")
    await click(button("Test connection"))
    assert.equal(requests.at(-1)!.url.searchParams.get("cwd"), "/workspace/team/app")
    await select("Effective scope", "app /workspace/client/app", "app", "/workspace/client")
    assert.equal(inventory(), null)
    await click(button("Save"))
    assert.equal(requests.at(-1)!.url.searchParams.get("cwd"), "/workspace/client/app")
    assert.equal(requests.at(-1)!.body.scope, "project")
    assert.equal(requests.at(-1)!.body.sourceId, undefined)
    assert.deepEqual(form.saved(), { id: "saved-server", cwd: "/workspace/client/app" })
  } finally { await form.close() }
})

test("global MCP scope clears the project context inherited from the resource page", async () => {
  const form = await mount("mcp", undefined, projects[0])
  try {
    await select("Effective scope", "Other project…")
    assert.equal(field("Project directory").value, projects[0])
    await type(field("Name"), "global-server")
    await type(field("Server URL"), "https://example.invalid/mcp")
    await click(button("Test connection"))
    assert.equal(requests.at(-1)!.url.searchParams.get("cwd"), projects[0])
    await select("Effective scope", "All projects")
    assert.equal(inventory(), null)
    await click(button("Test connection"))
    assert.equal(requests.at(-1)!.url.searchParams.has("cwd"), false)
    await click(button("Save"))
    assert.equal(requests.at(-1)!.url.searchParams.has("cwd"), false)
    assert.equal(requests.at(-1)!.body.scope, "global")
    assert.equal(requests.at(-1)!.body.sourceId, undefined)
    assert.deepEqual(form.saved(), { id: "saved-server", cwd: undefined })
  } finally { await form.close() }
})

test("effective scope labels and project groups are localized in both resource dialogs", async () => {
  await i18n.changeLanguage("zh-CN")
  try {
    for (const kind of ["skills", "mcp"] as const) {
      const form = await mount(kind)
      try {
        assert.equal(field("生效范围").value, "所有项目")
        await openCombobox("生效范围")
        assert.deepEqual([...document.querySelectorAll('[data-slot="combobox-label"]')].map((label) => label.textContent), ["全局生效", "指定项目"])
        await select("生效范围", "alpha /workspace/alpha", "alpha", "alpha")
      } finally { await form.close() }
    }
  } finally { await i18n.changeLanguage("en") }
})

test("MCP edit preserves headers and provider fields through JSON mode and rejects invalid row conversion", async () => {
  const detail: McpDetail = { id: "existing", name: "example", sourceId: "global", source: groups[0].source, transport: "http", target: "https://example.invalid/mcp", headerCount: 1, enabled: true, effective: true, override: false,
    definition: { url: "https://example.invalid/mcp", headers: { Authorization: "Bearer original" }, timeout: 42 }, effectiveDefinition: null }
  const form = await mount("mcp", detail)
  try {
    assert.equal(field("Header 1 value").value, "Bearer original")
    await click(button("Full configuration (JSON)"))
    const raw = document.querySelector<HTMLTextAreaElement>("textarea")!
    assert.deepEqual(JSON.parse(raw.value).headers, { Authorization: "Bearer original" })
    await type(raw, JSON.stringify({ ...detail.definition, headers: { "X-Test": 123 } }))
    await click(button("Configuration"))
    assert.match(document.querySelector('[role="alert"]')!.textContent!, /string values/)
    assert.ok(document.querySelector("textarea"))
    await type(raw, JSON.stringify({ ...detail.definition, headers: { "X-Test": "changed" } }))
    await click(button("Configuration"))
    assert.equal(field("Header 1 key").value, "X-Test")
    await click(button("Save"))
    assert.equal(requests.at(-1)!.method, "PATCH")
    assert.deepEqual(requests.at(-1)!.body.definition, { timeout: 42, type: "http", url: detail.definition.url, headers: { "X-Test": "changed" } })
  } finally { await form.close() }
})

test("header validation blocks requests without silently dropping values", async () => {
  const form = await mount("mcp")
  try {
    await type(field("Server URL"), "https://example.invalid/mcp")
    await click(button("Add header"))
    await type(field("Header 1 value"), "keep me")
    await click(button("Test connection"))
    assert.equal(requests.length, 0)
    assert.match(document.querySelector('[role="alert"]')!.textContent!, /key for every header value/)
    await type(field("Header 1 key"), "X-Key")
    await click(button("Add header"))
    await type(field("Header 2 key"), "x-key")
    await click(button("Test connection"))
    assert.equal(requests.length, 0)
    assert.match(document.querySelector('[role="alert"]')!.textContent!, /unique/)
  } finally { await form.close() }
})

test("MCP success shows localized counts without tool names or multiline lists", async () => {
  const form = await mount("mcp")
  try {
    await type(field("Server URL"), "https://example.invalid/mcp")
    testReply = () => Response.json({ ...capabilities, tools: [], prompts: [], resources: [] })
    await click(button("Test connection"))
    await act(async () => { await i18n.changeLanguage("zh-CN") })
    assert.match(inventory()!.closest('[role="status"]')!.textContent!, /^MCP服务测试成功，发现：/)
    assert.equal(inventory()!.textContent, "MCP服务测试成功，发现：工具（0）、提示词（0）、资源（0）")
    testReply = () => Response.json({ ...capabilities, tools: Array.from({ length: 80 }, (_, index) => ({ name: `tool_${index}` })), resources: [{ name: "<script>literal</script>", uri: "resource://literal" }] })
    await click(button("测试连接"))
    assert.equal(inventory()!.textContent, "MCP服务测试成功，发现：工具（80）、提示词（1）、资源（1）")
    assert.equal(inventory()!.querySelector("script"), null)
    assert.equal(inventory()!.querySelector("ul, li, br, p"), null)
  } finally { await form.close(); await i18n.changeLanguage("en") }
})

test("a failed MCP retest clears the success inventory and reports the error", async () => {
  const form = await mount("mcp")
  try {
    await type(field("Server URL"), "https://example.invalid/mcp")
    await click(button("Test connection"))
    assert.ok(inventory())
    testReply = () => Response.json({ detail: "Fixture connection failed" }, { status: 502 })
    await click(button("Test connection"))
    assert.equal(inventory(), null)
    assert.equal(document.querySelector('[role="alert"]')!.textContent, "Fixture connection failed")
  } finally { await form.close() }
})

test("a late probe result cannot certify a draft edited while testing", async () => {
  const form = await mount("mcp")
  try {
    let finish!: (response: Response) => void
    testReply = () => new Promise((resolve) => { finish = resolve })
    await type(field("Server URL"), "https://example.invalid/old")
    await click(button("Test connection"))
    await type(field("Server URL"), "https://example.invalid/new")
    await act(async () => { finish(Response.json(capabilities)) })
    assert.equal(inventory(), null)
    testReply = () => Response.json(capabilities)
    await click(button("Test connection"))
    assert.ok(inventory())
    assert.equal((requests.at(-1)!.body.definition as { url: string }).url, "https://example.invalid/new")
  } finally { await form.close() }
})
