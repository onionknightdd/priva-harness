import assert from "node:assert/strict"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"
import type { FileBrowserGitView } from "../../../src/features/file-browser/components/file-address-bar"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "Element", "Node", "DocumentFragment", "ShadowRoot", "SVGElement", "Event", "KeyboardEvent", "MouseEvent", "FocusEvent", "MutationObserver", "getComputedStyle"]) {
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
dom.window.HTMLElement.prototype.scrollBy = () => {}
after(() => dom.window.close())

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { I18nextProvider, initReactI18next } = await import("react-i18next")
const i18n = (await import("i18next")).createInstance()
const { en } = await import("../../../src/i18n/locales/en")
const { zhCN } = await import("../../../src/i18n/locales/zh-CN")
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en }, "zh-CN": { translation: zhCN } } })
const { FileAddressBar } = await import("../../../src/features/file-browser/components/file-address-bar")
const { emptyFileBrowserModel, getFileBrowserBreadcrumb } = await import("../../../src/features/file-browser/file-browser-data")
const { TooltipProvider } = await import("../../../src/components/ui/tooltip")

async function mount(path = "/workspace/repo/src", condensed = false) {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const navigations: string[] = []
  let git: FileBrowserGitView | undefined
  let selectedPath = path
  const render = () => root.render(<I18nextProvider i18n={i18n}><TooltipProvider>
    <FileAddressBar breadcrumb={getFileBrowserBreadcrumb(selectedPath, "/workspace")} condensed={condensed}
      currentDirectory={selectedPath} treeVisible model={emptyFileBrowserModel} git={git}
      onNavigate={(next) => navigations.push(next)} onCreateFolder={() => {}} onUpload={() => {}} onGoTo={async () => false} />
  </TooltipProvider></I18nextProvider>)
  const onChange = (value: string) => { git = { ...git!, active: value === "git" }; render() }
  await act(async () => render())
  return {
    host, navigations,
    tabs: () => host.querySelector<HTMLElement>("[data-file-browser-view-tabs]"),
    tab: (value: string) => host.querySelector<HTMLButtonElement>(`[data-file-browser-view-tabs] [data-tabs-value="${value}"]`),
    async setRepository(repo: string | null) { git = repo ? { root: repo, active: false, controls: { files: "files-workspace", git: "git-workspace" }, onChange } : undefined; await act(async () => render()) },
    async navigate(next: string) { selectedPath = next; await act(async () => render()) },
    async close() { await act(async () => root.unmount()); host.remove() },
  }
}

test("view tabs appear only inside a verified repository and immediately precede Create folder", async () => {
  const view = await mount()
  try {
    assert.equal(view.tabs(), null)
    await view.setRepository("/workspace/repo")
    assert.equal(view.tabs()!.querySelectorAll('[role="tab"]').length, 2)
    assert.equal(view.tabs()!.nextElementSibling?.getAttribute("aria-label"), "Create folder")
    assert.equal(view.tab("git")!.getAttribute("aria-controls"), "git-workspace")
    assert.equal(view.tab("files")!.getAttribute("aria-controls"), "files-workspace")
    assert.equal(view.host.querySelector('[aria-current="location"]')?.textContent, "src")
    await view.navigate("/workspace/repo-other")
    assert.equal(view.tabs(), null)
    await view.navigate("/workspace/repo")
    assert.ok(view.tabs())
    await view.setRepository(null)
    assert.equal(view.tabs(), null)
  } finally { await view.close() }
})

test("tabs select files or Git without navigating; selecting the active tab keeps its view", async () => {
  const view = await mount()
  try {
    await view.setRepository("/workspace/repo")
    const button = view.tab("git")!
    assert.equal(button.getAttribute("aria-selected"), "false")
    assert.equal(view.tab("files")!.getAttribute("aria-selected"), "true")
    await act(async () => button.click())
    assert.equal(view.tab("git"), button)
    assert.equal(button.getAttribute("aria-selected"), "true")
    await act(async () => button.click())
    assert.equal(button.getAttribute("aria-selected"), "true")
    await act(async () => view.tab("files")!.click())
    assert.equal(button.getAttribute("aria-selected"), "false")
    assert.deepEqual(view.navigations, [])
    const repo = [...view.host.querySelectorAll<HTMLButtonElement>('[data-slot="breadcrumb"] button')].find((item) => item.textContent === "repo")!
    await act(async () => repo.click())
    assert.deepEqual(view.navigations, ["/workspace/repo"])
    await act(async () => i18n.changeLanguage("zh-CN"))
    assert.ok(view.tab("files")!.textContent?.includes("文件"))
    assert.equal(view.tabs()!.querySelector('[role="tablist"]')?.getAttribute("aria-label"), "工作区视图")
  } finally { await view.close(); await i18n.changeLanguage("en") }
})

for (const condensed of [false, true]) {
  test(`long ${condensed ? "narrow" : "wide"} paths keep the view tabs reachable and offer hidden directories in menus`, async () => {
    const view = await mount("/workspace/projects/team/repo/src/features/components/deep", condensed)
    try {
      await view.setRepository("/workspace/projects/team/repo")
      assert.ok(view.tabs())
      assert.equal(view.host.querySelector('[aria-current="location"]')?.textContent, "deep")
      const menus = view.host.querySelectorAll<HTMLButtonElement>('[aria-label="Open hidden path"]')
      assert.equal(menus.length, 1)
      await act(async () => menus[0].click())
      const entry = [...document.querySelectorAll<HTMLElement>("[data-path-menu-result]")].find((item) => item.textContent === "team")
      assert.ok(entry)
      await act(async () => entry.click())
      assert.deepEqual(view.navigations, ["/workspace/projects/team"])
    } finally { await view.close() }
  })
}
