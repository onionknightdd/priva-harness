import assert from "node:assert/strict"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"
import type { FileBrowserItem } from "../../../src/features/file-browser/file-browser-data"
import type { FilePreviewResponse, FileSystemDirectory } from "../../../src/lib/api/sandbox-files"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" })
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const originalFetch = globalThis.fetch
type Pending = { url: URL; settled: boolean; resolve: (response: Response) => void }
const requests: Pending[] = []
globalThis.fetch = async (input) => new Promise<Response>((resolve) => requests.push({ url: new URL(String(input), "http://localhost"), settled: false, resolve }))
after(() => { dom.window.close(); globalThis.fetch = originalFetch })

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { UploadQueueContext } = await import("../../../src/features/uploads/upload-queue-context")
const { useFileBrowser } = await import("../../../src/features/file-browser/use-file-browser")

function directory(path = "/workspace"): FileSystemDirectory {
  return { root: "/workspace", path, parent: path === "/workspace" ? null : "/workspace", entries: path === "/workspace" ? [
    { path: "/workspace/a", name: "a", type: "directory", size: null, modified: null, permissions: null },
    { path: "/workspace/b", name: "b", type: "directory", size: null, modified: null, permissions: null },
    { path: "/workspace/note.txt", name: "note.txt", type: "file", size: 3, modified: null, permissions: null },
  ] : [] }
}
function file(path = "/workspace/note.txt"): FileBrowserItem {
  return { path, name: path.split("/").at(-1)!, type: "file", size: null, modifiedAt: null, permissions: null, parentPath: path.slice(0, path.lastIndexOf("/")) }
}
function preview(path = "/workspace/note.txt", content = "old"): FilePreviewResponse {
  return { path, name: path.split("/").at(-1)!, mime_type: "text/plain", size: content.length, content, is_binary: false, preview_url: null, preview_error: null }
}
const pending = (endpoint: string, path?: string) => {
  const request = requests.findLast((entry) => !entry.settled && entry.url.pathname.endsWith(endpoint) && (path === undefined ? !entry.url.searchParams.has("path") : entry.url.searchParams.get("path") === path))
  assert.ok(request, `${endpoint}: ${path}`)
  return request
}
const respond = async (request: Pending, payload: unknown) => { request.settled = true; await act(async () => request.resolve(Response.json(payload))) }

async function mount() {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  let browser: ReturnType<typeof useFileBrowser>
  function Probe() { browser = useFileBrowser(); return null }
  await act(async () => root.render(<UploadQueueContext value={{ enqueueFiles: () => { throw new Error("Uploads are not used in these tests") } }}><Probe /></UploadQueueContext>))
  await respond(pending("/list"), directory())
  return { get browser() { return browser! }, close: async () => { await act(async () => root.unmount()); host.remove() } }
}

test("newer cwd navigation wins even when an older directory read finishes last", async () => {
  const view = await mount()
  try {
    let first!: Promise<boolean>
    let second!: Promise<boolean>
    await act(async () => { first = view.browser.goToDirectory("/workspace/a") })
    const oldRead = pending("/list", "/workspace/a")
    await act(async () => { second = view.browser.goToDirectory("/workspace/b") })
    await respond(pending("/list", "/workspace/b"), directory("/workspace/b"))
    await respond(pending("/list", "/workspace"), directory())
    assert.equal(await second, true)
    assert.equal(view.browser.currentDirectory, "/workspace/b")
    await respond(oldRead, directory("/workspace/a"))
    assert.equal(await first, false)
    assert.equal(view.browser.currentDirectory, "/workspace/b")
  } finally { await view.close() }
})

test("an explicit file selection supersedes directory navigation awaiting ancestor reads", async () => {
  const view = await mount()
  try {
    let navigation!: Promise<boolean>
    await act(async () => { navigation = view.browser.goToDirectory("/workspace/a") })
    await respond(pending("/list", "/workspace/a"), directory("/workspace/a"))
    const ancestor = pending("/list", "/workspace")
    await act(async () => { void view.browser.selectItem("/workspace/note.txt") })
    await respond(pending("/preview", "/workspace/note.txt"), preview())
    await respond(ancestor, directory())
    assert.equal(await navigation, false)
    assert.equal(view.browser.selectedItem?.path, "/workspace/note.txt")
    assert.equal(view.browser.activeFileId, "/workspace/note.txt")
  } finally { await view.close() }
})

test("a superseded openPath never opens or activates its late preview", async () => {
  const view = await mount()
  try {
    let opening!: Promise<void>
    await act(async () => { opening = view.browser.openPath("/workspace/a/late.txt") })
    const parent = pending("/list", "/workspace/a")
    await act(async () => { void view.browser.openFile(file()) })
    await respond(pending("/preview", "/workspace/note.txt"), preview())
    await respond(parent, directory("/workspace/a"))
    await opening
    assert.equal(view.browser.activeFileId, "/workspace/note.txt")
    assert.ok(!requests.some((entry) => entry.url.pathname.endsWith("/preview") && entry.url.searchParams.get("path") === "/workspace/a/late.txt"))
  } finally { await view.close() }
})

test("refresh after Git mutation does not reopen a tab closed while its old preview is pending", async () => {
  const view = await mount()
  try {
    await act(async () => { void view.browser.openFile(file()) })
    const initial = pending("/preview", "/workspace/note.txt")
    let refreshing!: Promise<void>
    await act(async () => { refreshing = view.browser.refreshOpenedFiles() })
    await act(async () => view.browser.closeFile("/workspace/note.txt"))
    const before = requests.length
    await respond(initial, preview())
    await refreshing
    assert.equal(requests.length, before)
    assert.equal(view.browser.openedFiles.length, 0)
    assert.equal(view.browser.activeFileId, null)
  } finally { await view.close() }
})

test("refresh updates open working-tree content without changing the active tab", async () => {
  const view = await mount()
  try {
    await act(async () => { void view.browser.openFile(file()) })
    await respond(pending("/preview", "/workspace/note.txt"), preview())
    await act(async () => { void view.browser.openFile(file("/workspace/other.txt")) })
    await respond(pending("/preview", "/workspace/other.txt"), preview("/workspace/other.txt", "other"))
    let refreshing!: Promise<void>
    await act(async () => { refreshing = view.browser.refreshOpenedFiles() })
    await respond(pending("/preview", "/workspace/note.txt"), preview("/workspace/note.txt", "after checkout"))
    await respond(pending("/preview", "/workspace/other.txt"), preview("/workspace/other.txt", "also updated"))
    await refreshing
    assert.equal(view.browser.activeFileId, "/workspace/other.txt")
    assert.equal(view.browser.openedFiles.find((entry) => entry.path === "/workspace/note.txt")?.content, "after checkout")
  } finally { await view.close() }
})
