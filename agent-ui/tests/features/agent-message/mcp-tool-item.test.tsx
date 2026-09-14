import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

import type { StreamBlock } from "../../../src/features/agent-message/agent-message-data.ts"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "ShadowRoot", "SVGElement", "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "DOMRect", "MutationObserver", "getComputedStyle"]) {
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
let clipboard = ""
Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { clipboard = text } } })
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) return { format: "module", source: "export default {}", shortCircuit: true }
    if (url.endsWith(".svg")) return { format: "module", source: `export default ${JSON.stringify(url)}`, shortCircuit: true }
    // The dispatcher imports Visualize, but these tests never render its iframe.
    if (url === "virtual:visualize-sandbox-runtime") return { format: "module", source: 'export default ""', shortCircuit: true }
    const result = nextLoad(url, context)
    // Supply Vite's asset environment for the imported file icon component.
    if (url.endsWith("/file-type-icon.tsx")) return { ...result, source: `import.meta.env = { DEV: false, BASE_URL: "/" };\n${result.source}` }
    return result
  },
})
after(() => { hooks.deregister(); dom.window.close() })

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { I18nextProvider, initReactI18next } = await import("react-i18next")
const i18n = (await import("i18next")).createInstance()
const { en } = await import("../../../src/i18n/locales/en.ts")
const { zhCN } = await import("../../../src/i18n/locales/zh-CN.ts")
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en }, "zh-CN": { translation: zhCN } } })
const { ToolItem } = await import("../../../src/features/agent-message/components/assistant-process.tsx")

type ToolBlock = Extract<StreamBlock, { type: "tool_use" }>
const completed: ToolBlock = {
  type: "tool_use", id: "tool", blockId: "tool", index: 0, name: "mcp__GitHub__list_issues",
  input: { labels: ["bug"], limit: 0, archived: false },
  tool: { id: "tool", name: "mcp__GitHub__list_issues", status: "completed", ok: true, output: '{"issues":[]}\n<literal output>' },
}

async function mount(block = completed, language = "en") {
  await i18n.changeLanguage(language)
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const update = async (next: ToolBlock) => {
    await act(async () => root.render(<I18nextProvider i18n={i18n}><ToolItem block={next} /></I18nextProvider>))
  }
  await update(block)
  return {
    host, update,
    title: () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!,
    async open() {
      const button = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!
      if (button.getAttribute("aria-expanded") === "false") await act(async () => button.click())
    },
    async close() { await act(async () => root.unmount()); host.remove() },
  }
}

test("the real tool dispatcher renders the MCP icon, compact title and normal input/output", async () => {
  const view = await mount()
  try {
    assert.equal(view.title().getAttribute("aria-expanded"), "false")
    assert.ok(view.title().textContent!.includes("GitHub:list_issues"))
    assert.ok(!view.title().textContent!.includes("mcp__"))
    const icon = view.host.querySelector<HTMLElement>('[data-slot="mcp-tool-icon"]')!
    assert.ok(icon.style.maskImage.endsWith('mcp.svg")'))
    assert.equal(icon.getAttribute("aria-hidden"), "true")
    assert.ok(icon.classList.contains("bg-current"))
    await view.open()
    assert.deepEqual([...view.host.querySelectorAll("dt")].map((item) => item.textContent), ["Input", "Output"])
    assert.deepEqual([...view.host.querySelectorAll("pre")].map((item) => item.textContent), [JSON.stringify(completed.input, null, 2), completed.tool!.output])
    assert.ok(view.host.querySelector('[data-state="success"]'))
  } finally { await view.close() }
})

test("running MCP calls show input deltas and update the output without changing the title", async () => {
  const view = await mount({ ...completed, input: {}, tool: { ...completed.tool!, status: "started", inputRaw: '{"query":"hel', output: undefined } })
  try {
    assert.equal(view.title().getAttribute("aria-expanded"), "true")
    assert.equal(view.host.querySelector("pre")!.textContent, '{"query":"hel')
    await view.update({ ...completed, tool: { ...completed.tool!, status: "running", inputRaw: '{"query":"hello"}', output: "first\nsecond" } })
    assert.deepEqual([...view.host.querySelectorAll("pre")].map((item) => item.textContent), ['{\n  "query": "hello"\n}', "first\nsecond"])
    assert.ok(view.title().textContent!.includes("GitHub:list_issues"))
    assert.ok(view.host.querySelector('[aria-busy="true"]'))
  } finally { await view.close() }
})

test("errors preserve their raw output and localize only the input/output labels", async () => {
  const error = '{"error":"Denied <detail>"}\noriginal message'
  const view = await mount({ ...completed, tool: { ...completed.tool!, ok: false, output: error } }, "zh-CN")
  try {
    await view.open()
    assert.deepEqual([...view.host.querySelectorAll("dt")].map((item) => item.textContent), ["输入", "输出"])
    assert.equal(view.host.querySelector('[role="alert"]')!.textContent, error)
    assert.ok(view.host.querySelector('[data-state="error"]'))
    assert.ok(view.title().textContent!.includes("GitHub:list_issues"))
  } finally { await view.close() }
})

test("copy includes the displayed input and output, and absent input creates no empty section", async () => {
  const view = await mount()
  try {
    await view.open()
    const copy = view.host.querySelector<HTMLButtonElement>('button[aria-label="Copy result"]')!
    await act(async () => copy.click())
    assert.equal(clipboard, `${JSON.stringify(completed.input, null, 2)}\n\n${completed.tool!.output}`)
    await view.update({ ...completed, input: undefined })
    assert.deepEqual([...view.host.querySelectorAll("dt")].map((item) => item.textContent), ["Output"])
  } finally { await view.close() }
})

test("native Bash keeps its terminal card while an external tool named Read uses the MCP card", async () => {
  const native = await mount({ ...completed, name: "Bash", input: undefined, tool: { ...completed.tool!, name: "Bash", output: "" } })
  try {
    assert.ok(native.host.querySelector(".lucide-square-terminal"))
    assert.equal(native.host.querySelector('[data-slot="mcp-tool-icon"]'), null)
  } finally { await native.close() }
  const external = await mount({ ...completed, name: "mcp__files__Read" })
  try {
    assert.ok(external.host.querySelector('[data-slot="mcp-tool-icon"]'))
    assert.ok(external.title().textContent!.includes("files:Read"))
  } finally { await external.close() }
})
