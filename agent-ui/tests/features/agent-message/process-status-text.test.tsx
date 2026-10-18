import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { after, test, type TestContext } from "node:test"
import { JSDOM } from "jsdom"

import type { AgentThreadMessage, StreamBlock } from "../../../src/features/agent-message/agent-message-data.ts"

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
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) return { format: "module", source: "export default {}", shortCircuit: true }
    if (url.endsWith(".svg")) return { format: "module", source: `export default ${JSON.stringify(url)}`, shortCircuit: true }
    // AssistantProcess imports the dispatcher, but these cases render no iframe.
    if (url === "virtual:visualize-sandbox-runtime") return { format: "module", source: 'export default ""', shortCircuit: true }
    const result = nextLoad(url, context)
    if (url.endsWith("/file-type-icon.tsx")) return { ...result, source: `import.meta.env = { DEV: false, BASE_URL: "/" };\n${result.source}` }
    return result
  },
})
after(() => { hooks.deregister(); dom.window.close() })

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { MotionConfig } = await import("motion/react")
const { I18nextProvider, initReactI18next } = await import("react-i18next")
const { createInstance } = await import("i18next")
const { en } = await import("../../../src/i18n/locales/en.ts")
const { zhCN } = await import("../../../src/i18n/locales/zh-CN.ts")
const { ProcessStatusText } = await import("../../../src/features/agent-message/components/process-status-text.tsx")
const { AssistantProcess } = await import("../../../src/features/agent-message/components/assistant-process.tsx")

type ToolBlock = Extract<StreamBlock, { type: "tool_use" }>
const startedAt = Date.parse("2026-10-18T00:00:00.000Z")
const reading: ToolBlock = {
  type: "tool_use", blockId: "read-0", index: 0, id: "read-0", name: "read",
  tool: { id: "read-0", name: "read", status: "started" },
}

function message(blocks: StreamBlock[] = [reading]): AgentThreadMessage {
  return { id: "message", role: "assistant", content: "", createdAt: new Date(startedAt).toISOString(), status: "streaming", blocks }
}

function manualClock(context: TestContext) {
  let now = startedAt + 4_000
  let nextId = 1
  const active = new Map<number, { callback: () => void; delay: number | undefined }>()
  const created: number[] = []
  context.mock.method(Date, "now", () => now)
  context.mock.method(window, "setInterval", (callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    assert.equal(typeof callback, "function")
    const id = nextId++
    created.push(id)
    active.set(id, { callback: () => (callback as (...values: unknown[]) => void)(...args), delay })
    return id
  })
  context.mock.method(window, "clearInterval", (id?: number) => { if (id !== undefined) active.delete(id) })
  return {
    active, created,
    async tick() {
      now += 1_000
      await act(async () => { for (const timer of [...active.values()]) timer.callback() })
    },
  }
}

// aria-hidden glyph layers must not duplicate the sentence read by assistive technology.
function accessibleText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ""
  if (node instanceof Element && (node.getAttribute("aria-hidden") === "true" || node.hasAttribute("hidden"))) return ""
  return [...node.childNodes].map(accessibleText).join("")
}

function textBranch(host: HTMLElement, text: string): Element {
  const branch = [...host.querySelectorAll("*")].find((node) => accessibleText(node) === text)
  assert.ok(branch, `Expected an accessible text branch containing ${JSON.stringify(text)}`)
  return branch
}

async function mount(context: TestContext, content: React.ReactNode) {
  const clock = manualClock(context)
  const i18n = createInstance()
  await i18n.use(initReactI18next).init({ lng: "zh-CN", resources: { en: { translation: en }, "zh-CN": { translation: zhCN } } })
  const translate = i18n.t.bind(i18n)
  const translations: string[] = []
  context.mock.method(i18n, "t", (...args: Parameters<typeof i18n.t>) => {
    translations.push(String(args[0]))
    return translate(...args)
  })
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const update = async (next: React.ReactNode) => {
    await act(async () => root.render(<I18nextProvider i18n={i18n}><MotionConfig reducedMotion="always">{next}</MotionConfig></I18nextProvider>))
  }
  await update(content)
  return {
    host, clock, update,
    summaryCalls: () => translations.filter((key) => key.startsWith("agentMessage.toolSummary.")).length,
    async changeLanguage(language: string) { await act(async () => { await i18n.changeLanguage(language) }) },
    async close() { await act(async () => root.unmount()); host.remove() },
  }
}

test("clock ticks preserve the statistics DOM without reading tools or repeating translations", async (context) => {
  let blockReads = 0
  const blocks = new Proxy([reading], {
    get(target, key, receiver) {
      blockReads += 1
      return Reflect.get(target, key, receiver)
    },
  })
  const view = await mount(context, <ProcessStatusText message={message(blocks)} isStreaming />)
  const mutations: MutationRecord[] = []
  const observer = new MutationObserver((records) => mutations.push(...records))
  try {
    const statistics = textBranch(view.host, "，正在读取1个文件")
    const originalNodes = [...statistics.querySelectorAll("*")]
    const originalHtml = statistics.innerHTML
    const initialTranslations = view.summaryCalls()
    assert.ok(initialTranslations > 0)
    assert.equal(view.clock.active.size, 1)
    assert.equal([...view.clock.active.values()][0].delay, 1_000)
    assert.equal(accessibleText(view.host), "已运行 4s，正在读取1个文件")
    observer.observe(view.host, { subtree: true, childList: true, characterData: true })
    assert.ok(blockReads > 0, "The initial summary should inspect the tools")
    blockReads = 0

    await view.clock.tick()
    await view.clock.tick()

    assert.equal(accessibleText(view.host), "已运行 6s，正在读取1个文件")
    assert.equal(textBranch(view.host, "，正在读取1个文件"), statistics)
    assert.equal(statistics.innerHTML, originalHtml)
    assert.ok(originalNodes.every((node) => node.isConnected))
    assert.ok(mutations.length > 0, "The rendered clock should have changed")
    assert.ok(mutations.every((mutation) => !statistics.contains(mutation.target)))
    assert.equal(view.summaryCalls(), initialTranslations)
    assert.equal(blockReads, 0, "Clock-only updates should not inspect the tool collection")
  } finally {
    observer.disconnect()
    await view.close()
  }
  assert.equal(view.clock.active.size, 0)
})

test("body and tool output updates leave statistics untouched, while tool completion updates them", async (context) => {
  const view = await mount(context, <ProcessStatusText message={message()} isStreaming />)
  try {
    const statistics = textBranch(view.host, "，正在读取1个文件")
    const originalHtml = statistics.innerHTML
    const initialTranslations = view.summaryCalls()
    const output: ToolBlock = { ...reading, tool: { ...reading.tool!, output: "first result", input: { path: "README.md" } } }
    const next = { ...message([output, { type: "text", blockId: "answer", index: 1, text: "A growing answer" }]), content: "A growing answer" }
    await view.update(<ProcessStatusText message={next} isStreaming />)
    assert.equal(textBranch(view.host, "，正在读取1个文件"), statistics)
    assert.equal(statistics.innerHTML, originalHtml)
    assert.equal(view.summaryCalls(), initialTranslations)

    await view.update(<ProcessStatusText message={message([{ ...output, tool: { ...output.tool!, status: "completed" } }])} isStreaming />)
    assert.equal(accessibleText(view.host), "已运行 4s，已读取1个文件")
    assert.ok(view.summaryCalls() > initialTranslations)
  } finally { await view.close() }
})

test("the accessible sentence contains one current clock and summary through completion", async (context) => {
  const view = await mount(context, <ProcessStatusText message={message()} isStreaming />)
  try {
    assert.equal(accessibleText(view.host), "已运行 4s，正在读取1个文件")
    await view.clock.tick()
    assert.equal(accessibleText(view.host), "已运行 5s，正在读取1个文件")
    const settled = { ...message([{ ...reading, tool: { ...reading.tool!, status: "completed" as const } }]), status: "complete" as const, durationMs: 5_000 }
    await view.update(<ProcessStatusText message={settled} isStreaming={false} />)
    assert.equal(accessibleText(view.host), "用时 5s，已读取1个文件")
    assert.equal(view.clock.active.size, 0)
  } finally { await view.close() }
})

test("language changes refresh the memoized statistics without restarting the clock", async (context) => {
  const view = await mount(context, <ProcessStatusText message={message()} isStreaming />)
  try {
    const initialTranslations = view.summaryCalls()
    assert.equal(accessibleText(view.host), "已运行 4s，正在读取1个文件")
    await view.changeLanguage("en")
    assert.equal(accessibleText(view.host), "Running for 4s, Reading 1 file")
    assert.ok(view.summaryCalls() > initialTranslations)
    assert.equal(view.clock.created.length, 1)
    assert.equal(view.clock.active.size, 1)
    await view.changeLanguage("zh-CN")
    assert.equal(accessibleText(view.host), "已运行 4s，正在读取1个文件")
  } finally { await view.close() }
})

test("a hidden AssistantProcess header never creates a process clock", async (context) => {
  const view = await mount(context, <AssistantProcess message={message([])} isStreaming hideHeader />)
  try {
    assert.equal(view.clock.created.length, 0)
    assert.equal(view.clock.active.size, 0)
    assert.equal(accessibleText(view.host), "")
  } finally { await view.close() }
})

test("a visible AssistantProcess header owns one clock and releases it when hidden or unmounted", async (context) => {
  const empty = message([])
  const view = await mount(context, <AssistantProcess message={empty} isStreaming />)
  try {
    assert.equal(view.clock.created.length, 1)
    assert.equal(view.clock.active.size, 1)
    assert.equal(accessibleText(view.host), "已运行 4s")
    await view.update(<AssistantProcess message={empty} isStreaming hideHeader />)
    assert.equal(view.clock.active.size, 0)
    await view.update(<AssistantProcess message={empty} isStreaming />)
    assert.equal(view.clock.created.length, 2)
    assert.equal(view.clock.active.size, 1)
  } finally { await view.close() }
  assert.equal(view.clock.active.size, 0)
})
