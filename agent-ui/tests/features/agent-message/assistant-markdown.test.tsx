import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

import type { AgentMessageStatus, AgentThreadMessage } from "../../../src/features/agent-message/agent-message-data.ts"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "ShadowRoot", "SVGElement", "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "DOMRect", "MutationObserver", "getComputedStyle", "AbortController", "AbortSignal"]) {
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
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) return { format: "module", source: "export default {}", shortCircuit: true }
    if (url.endsWith(".svg")) return { format: "module", source: `export default ${JSON.stringify(url)}`, shortCircuit: true }
    // The message imports the tool dispatcher, but these tests render prose.
    if (url === "virtual:visualize-sandbox-runtime") return { format: "module", source: 'export default ""', shortCircuit: true }
    const result = nextLoad(url, context)
    if (url.endsWith("/file-type-icon.tsx")) return { ...result, source: `import.meta.env = { DEV: false, BASE_URL: "/" };\n${result.source}` }
    return result
  },
})
const originalFetch = globalThis.fetch
const checkedPaths: string[] = []
globalThis.fetch = async (input, init) => {
  assert.equal(input, "/api/sandbox/files/exists")
  const { paths } = JSON.parse(String(init?.body)) as { paths: string[] }
  checkedPaths.push(...paths)
  return Response.json({ exists: Object.fromEntries(paths.map((path) => [path, !path.includes("missing")])) })
}
let clipboard = ""
Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { clipboard = text } } })
after(() => { hooks.deregister(); dom.window.close(); globalThis.fetch = originalFetch })

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { I18nextProvider, initReactI18next } = await import("react-i18next")
const i18n = (await import("i18next")).createInstance()
const { en } = await import("../../../src/i18n/locales/en.ts")
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } } })
const { AgentMessageItem } = await import("../../../src/features/agent-message/components/agent-message-item.tsx")
const { SidebarProvider } = await import("../../../src/components/ui/sidebar.tsx")
const { WorkspaceFilesProvider, useOptionalWorkspaceFiles, useWorkspaceTab } = await import("../../../src/features/workspace/workspace-files-context.tsx")
const { QuoteInChatContext } = await import("../../../src/features/agent-message/selection-actions-context.ts")
let quotedPath: string | undefined

function OpenedFile() {
  const files = useOptionalWorkspaceFiles()
  return <output data-active-tab={useWorkspaceTab().activeTabId}>{files?.pendingFilePath}</output>
}

async function mount(content: string, status: AgentMessageStatus = "complete") {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const update = async (next: string, nextStatus = status) => {
    const message: AgentThreadMessage = { id: "assistant", role: "assistant", content: next, status: nextStatus, createdAt: "2026-01-01T00:00:00Z" }
    await act(async () => root.render(
      <I18nextProvider i18n={i18n}>
        <SidebarProvider stateCookieName={false} widthCookieName={false}>
          <WorkspaceFilesProvider>
            <QuoteInChatContext.Provider value={(quote) => { if (quote.type === "file") quotedPath = quote.path }}>
              <AgentMessageItem message={message} hideProcessHeader />
            </QuoteInChatContext.Provider>
            <OpenedFile />
          </WorkspaceFilesProvider>
        </SidebarProvider>
      </I18nextProvider>
    ))
  }
  await update(content)
  return { host, update, async close() { await act(async () => root.unmount()); host.remove() } }
}

const button = (host: ParentNode, label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent === label)!
async function click(element: HTMLElement) {
  assert.ok(element)
  await act(async () => element.click())
}

for (const status of ["complete", "streaming"] as const) {
  test(`${status} assistant messages open sandbox links in Workspace with the original label`, async () => {
    const path = `/workspace/${status}/测试文件.md`
    const view = await mount(`[测试文件](sandbox:${path})`, status)
    try {
      assert.ok(!view.host.textContent!.includes("[blocked]"))
      const link = button(view.host, "测试文件")
      assert.equal(link.getAttribute("aria-label"), "Open 测试文件")
      assert.equal(view.host.querySelector('a[href^="sandbox:"]'), null)
      await click(link)
      assert.equal(view.host.querySelector("output")!.textContent, path)
      assert.equal(view.host.querySelector("output")!.getAttribute("data-active-tab"), "files")
      assert.equal(document.querySelector('[role="dialog"]'), null)
    } finally { await view.close() }
  })

  test(`${status} messages support encoded paths, formatted labels and GFM tables`, async () => {
    const path = `/workspace/${status}/测试 file%#?.md`
    const view = await mount(`| 文件 |\n| --- |\n| [**测试** \`文件\`](sandbox:${encodeURI(path).replace("#", "%23").replace("?", "%3F")}) |`, status)
    try {
      assert.ok(!view.host.textContent!.includes("[blocked]"))
      const link = button(view.host.querySelector("table")!, "测试 文件")
      await click(link)
      assert.equal(view.host.querySelector("output")!.textContent, path)
    } finally { await view.close() }
  })
}

test("static reference links use the first matching Markdown definition", async () => {
  // Streamdown's streaming renderer splits definitions into separate blocks;
  // cross-block references are only resolved by its static renderer.
  const view = await mount("[引用标题][DOC]\n\n[doc]: sandbox:/workspace/reference.md\n\n[DOC]: sandbox:/workspace/duplicate.md")
  try {
    await click(button(view.host, "引用标题"))
    assert.equal(view.host.querySelector("output")!.textContent, "/workspace/reference.md")
  } finally { await view.close() }
})

test("a streamed link becomes a file reference when its destination is complete", async () => {
  const before = checkedPaths.length
  const view = await mount("[流式文件](sandbox:", "streaming")
  try {
    assert.equal(button(view.host, "流式文件")?.getAttribute("aria-label"), undefined)
    assert.equal(checkedPaths.length, before)
    await view.update("[流式文件](sandbox:/workspace/streamed.md)", "complete")
    await click(button(view.host, "流式文件"))
    assert.equal(view.host.querySelector("output")!.textContent, "/workspace/streamed.md")
  } finally { await view.close() }
})

test("missing files preserve the link label without offering an open action", async () => {
  const view = await mount("[缺失文件](sandbox:/workspace/missing.md)")
  try {
    assert.ok(view.host.textContent!.includes("缺失文件"))
    assert.ok(!view.host.textContent!.includes("[blocked]"))
    assert.equal(button(view.host, "缺失文件"), undefined)
    assert.equal(view.host.querySelector("output")!.textContent, "")
  } finally { await view.close() }
})

test("invalid sandbox links and raw custom tags cannot start file checks", async () => {
  const before = checkedPaths.length
  const urls = ["sandbox:relative.md", "sandbox://remote/file.md", "sandbox:/%2Fremote/file.md", "sandbox:/workspace/%00file.md", "sandbox:/workspace/%ZZ.md", "javascript:alert%281%29", "data:text/html,hello"]
  const view = await mount(urls.map((url, i) => `[unsafe${i}](${url})`).join("\n\n") + '\n\n<sandbox-file url="https://example.com/file.md" label="raw">raw content</sandbox-file>')
  try {
    assert.equal(checkedPaths.length, before)
    assert.equal(view.host.querySelectorAll('span[title^="Blocked URL:"]').length, urls.length)
    assert.ok(view.host.textContent!.includes("raw content"))
    assert.equal(button(view.host, "raw"), undefined)
    assert.equal(view.host.querySelector("output")!.textContent, "")
  } finally { await view.close() }
})

test("normal HTTPS links retain the existing external-link confirmation", async () => {
  const before = checkedPaths.length
  const view = await mount("[外部文档](https://example.com/docs)")
  try {
    await click(button(view.host, "外部文档"))
    const dialog = document.querySelector('[role="dialog"]')!
    assert.ok(dialog.textContent!.includes(i18n.t("common.openExternalLink")))
    assert.ok(dialog.textContent!.includes("https://example.com/docs"))
    assert.equal(checkedPaths.length, before)
    assert.equal(view.host.querySelector("output")!.textContent, "")
  } finally { await view.close() }
})

test("sandbox file references reuse copy-path and quote context-menu actions", async () => {
  const path = "/workspace/context/测试文件.md"
  const view = await mount(`[测试文件](sandbox:${path})`)
  try {
    async function openMenu() {
      await act(async () => button(view.host, "测试文件").focus())
      await act(async () => button(view.host, "测试文件").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2 })))
    }
    const menuItem = (key: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) => element.textContent === i18n.t(key))!
    await openMenu()
    await click(menuItem("agentMessage.fileReferenceMenu.copyPath"))
    assert.equal(clipboard, path)
    await openMenu()
    await click(menuItem("agentMessage.fileReferenceMenu.quote"))
    assert.equal(quotedPath, path)
  } finally { await view.close() }
})
