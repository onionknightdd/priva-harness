import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"
import type { GitActionOptions, GitRepository } from "../../../src/lib/api/git-repository"
import type { GitRepositoryController } from "../../../src/features/git/use-git-repository"
import type { GitSelection } from "../../../src/features/git/git-panels"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLButtonElement", "Element", "Node", "DocumentFragment", "ShadowRoot", "SVGElement", "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "MutationObserver", "getComputedStyle"]) {
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
const hooks = registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith(".css")) return { format: "module", source: "export default {}", shortCircuit: true }
  const result = nextLoad(url, context)
  if (url.endsWith("/file-type-icon.tsx")) return { ...result, source: `import.meta.env = { DEV: false, BASE_URL: "/" };\n${result.source}` }
  return result
} })
const originalFetch = globalThis.fetch
type Pending = { url: URL; signal?: AbortSignal; resolve: (response: Response) => void }
const requests: Pending[] = []
globalThis.fetch = async (input, init) => new Promise<Response>((resolve) => requests.push({ url: new URL(String(input), "http://localhost"), signal: init?.signal as AbortSignal | undefined, resolve }))
after(() => { hooks.deregister(); dom.window.close(); globalThis.fetch = originalFetch })
const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { I18nextProvider, initReactI18next } = await import("react-i18next")
const i18n = (await import("i18next")).createInstance()
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: {} } } })
const { GitTreePane, GitPreviewPane } = await import("../../../src/features/git/git-panels")
const repository: GitRepository = {
  cwd: "/repo", root: "/repo", branch: "main", commit: "a".repeat(40), upstream: "origin/main", remote: "origin", remotes: ["origin"], ahead: 2, behind: 1, operation: null,
  changes: [{ path: "notes.txt", originalPath: null, indexStatus: "M", worktreeStatus: "M", conflicted: false }],
  branches: [
    { name: "main", current: true, remote: false, upstream: "origin/main" },
    { name: "origin/main", current: false, remote: true, upstream: null },
    { name: "origin/release", current: false, remote: true, upstream: null },
  ],
}
const respond = async (request: Pending, data: unknown, status = 200) => { await act(async () => request.resolve(Response.json(data, { status }))) }
const lastRequest = () => requests.at(-1)!

async function mount(mode: "tree" | "preview", initialSelection: GitSelection | null = null, initialRepository = repository) {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const actions: GitActionOptions[] = []
  const opened: string[] = []
  let selection = initialSelection
  let active = true
  let actionResult = true
  let controller: GitRepositoryController = { repository: initialRepository, loading: false, error: null, refresh() {}, busy: null, actionError: null, actionMessage: null, perform: async (action) => { actions.push(action); return actionResult } }
  const render = () => root.render(<I18nextProvider i18n={i18n}>{mode === "tree" ? <GitTreePane controller={controller} selection={selection} onSelectionChange={(next) => { selection = next; render() }} active={active} /> : <GitPreviewPane controller={controller} selection={selection} onSelectionChange={(next) => { selection = next; render() }} onOpenFile={(path) => opened.push(path)} active={active} />}</I18nextProvider>)
  await act(async () => render())
  return {
    host, actions, opened, get selection() { return selection }, setActionResult(value: boolean) { actionResult = value },
    async update(next: { selection?: GitSelection | null; active?: boolean; repository?: GitRepository | null }) {
      if (next.selection !== undefined) selection = next.selection
      if (next.active !== undefined) active = next.active
      if (next.repository !== undefined) controller = { ...controller, repository: next.repository }
      await act(async () => render())
    },
    async click(selector: string) { const element = host.querySelector<HTMLElement>(selector); assert.ok(element, selector); await act(async () => element.click()) },
    async close() { await act(async () => root.unmount()); host.remove() },
  }
}

test("change groups keep partial stages separate without a commit form", async () => {
  const view = await mount("tree")
  try {
    assert.equal(view.host.querySelectorAll('[title="notes.txt"]').length, 2)
    await view.click('[aria-label="Stage file: notes.txt"]')
    await view.click('[aria-label="Unstage file: notes.txt"]')
    assert.deepEqual(view.actions, [{ action: "stage", paths: ["notes.txt"] }, { action: "unstage", paths: ["notes.txt"] }])
    assert.equal(view.host.querySelector('form, textarea, button[type="submit"]'), null)
  } finally { await view.close() }
})

test("history loads on demand, pages with an explicit offset and selects a real commit", async () => {
  const before = requests.length
  const view = await mount("tree")
  try {
    assert.equal(requests.length, before)
    await view.click('[role="tab"][data-tabs-value="history"]')
    assert.equal(lastRequest().url.pathname, "/api/sandbox/git/history")
    const commit = { id: "b".repeat(40), shortId: "bbbbbbb", parents: [], subject: "First commit", body: "", authorName: "Dev", authoredAt: "2026-10-24T00:00:00Z" }
    await respond(lastRequest(), { commits: [commit], hasMore: true })
    const commitButton = [...view.host.querySelectorAll("button")].find((button) => button.textContent?.includes("First commit"))!
    await act(async () => commitButton.click())
    assert.deepEqual(view.selection, { kind: "commit", commitId: commit.id })
    const more = [...view.host.querySelectorAll("button")].find((button) => button.textContent === "Load more commits")!
    await act(async () => more.click())
    assert.equal(lastRequest().url.searchParams.get("skip"), "1")
    await respond(lastRequest(), { commits: [], hasMore: false })
  } finally { await view.close() }
})

test("rename actions send only the selected destination so the service owns source-path expansion", async () => {
  const repo = { ...repository, changes: [{ path: "new.txt", originalPath: "old.txt", indexStatus: "R", worktreeStatus: "M", conflicted: false }] }
  const tree = await mount("tree", null, repo)
  try {
    await tree.click('[aria-label="Stage file: new.txt"]')
    await tree.click('[aria-label="Unstage file: new.txt"]')
    await tree.click('[aria-label="Stage all"]')
    assert.deepEqual(tree.actions, [{ action: "stage", paths: ["new.txt"] }, { action: "unstage", paths: ["new.txt"] }, { action: "stage", paths: ["new.txt"] }])
  } finally { await tree.close() }
  const preview = await mount("preview", { kind: "change", path: "new.txt", area: "staged" }, repo)
  try {
    const button = [...preview.host.querySelectorAll("button")].find((element) => element.textContent === "Unstage file")!
    await act(async () => button.click())
    assert.deepEqual(preview.actions, [{ action: "unstage", paths: ["new.txt"] }])
  } finally { await preview.close() }
})

test("the local dropdown only switches existing local branches", async () => {
  const view = await mount("tree", null, { ...repository, branches: [...repository.branches, { name: "feature/sidebar", current: false, remote: false, upstream: null }] })
  try {
    await view.click('[aria-label="Switch branch: main"]')
    const menu = document.querySelector('[data-slot="popover-content"]')!
    assert.ok(menu.querySelector('button[title="main"]'))
    assert.equal(menu.querySelector('button[title="origin/main"]'), null)
    assert.ok(!menu.textContent?.includes("Create branch"))
    const branch = menu.querySelector<HTMLButtonElement>('button[title="feature/sidebar"]')!
    assert.ok(branch)
    await act(async () => branch.click())
    assert.deepEqual(view.actions, [{ action: "switch", branch: "feature/sidebar" }])
  } finally { await view.close() }
})

test("tracked and unpublished branches expose Fetch only in the remote dropdown", async () => {
  const view = await mount("tree")
  try {
    for (const repo of [repository, { ...repository, upstream: null, remote: null }]) {
      await view.update({ repository: repo })
      const labels = [...view.host.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "")
      assert.ok(!labels.some((label) => /^(Pull|Push|Publish branch)(?:\s|$)/.test(label)))
      // Base UI Popover also uses role=dialog and can remain mounted while
      // closing. Only the shared Dialog slot identifies a publish dialog.
      assert.ok(!document.querySelector('[data-slot="dialog-content"]'))
      assert.equal(view.host.querySelector('[aria-label="Fetch"]'), null)
      const trigger = `[aria-label="Select remote branch: ${repo.upstream ?? "No upstream branch"}"]`
      await view.click(trigger)
      const fetch = document.querySelector<HTMLButtonElement>('[data-slot="popover-content"] button[aria-label="Fetch"]')!
      assert.ok(fetch)
      await act(async () => fetch.click())
      await view.click(trigger)
    }
    assert.deepEqual(view.actions, [{ action: "fetch" }, { action: "fetch" }])
  } finally { await view.close() }
})

test("the remote dropdown lists only remote branches and updates upstream without switching the local branch", async () => {
  const view = await mount("tree")
  try {
    await view.click('[aria-label="Select remote branch: origin/main"]')
    const menu = document.querySelector('[data-slot="popover-content"]')!
    assert.equal(menu.querySelector('button[title="main"]'), null)
    assert.equal(menu.querySelector<HTMLButtonElement>('button[title="origin/main"]')?.disabled, true)
    const release = menu.querySelector<HTMLButtonElement>('button[title="origin/release"]')!
    assert.ok(release)
    view.setActionResult(false)
    await act(async () => release.click())
    assert.ok(document.querySelector('[data-slot="popover-content"]'))
    view.setActionResult(true)
    await act(async () => release.click())
    assert.deepEqual(view.actions, [{ action: "set-upstream", branch: "origin/release" }, { action: "set-upstream", branch: "origin/release" }])
    await view.update({ repository: { ...repository, upstream: "origin/release" } })
    assert.ok(view.host.querySelector('[aria-label="Switch branch: main"]'))
    assert.ok(view.host.querySelector('[aria-label="Select remote branch: origin/release"]'))
  } finally { await view.close() }
})

test("the remote dropdown explains an empty list and prevents choosing upstream for detached HEAD", async () => {
  const view = await mount("tree", null, { ...repository, upstream: null, branch: null })
  try {
    await view.click('[aria-label="Select remote branch: No upstream branch"]')
    const menu = document.querySelector('[data-slot="popover-content"]')!
    assert.equal(menu.querySelector<HTMLButtonElement>('button[title="origin/release"]')?.disabled, true)
    assert.match(menu.textContent ?? "", /Check out a local branch/)
    await view.update({ repository: { ...repository, upstream: null, branches: repository.branches.filter((branch) => !branch.remote) } })
    await view.click('[aria-label="Select remote branch: No upstream branch"]')
    assert.match(document.querySelector('[data-slot="popover-content"]')?.textContent ?? "", /No remote branches available/)
    assert.deepEqual(view.actions, [])
  } finally { await view.close() }
})

test("diff navigation aborts old requests and keeps source on the selected Git baseline", async () => {
  const view = await mount("preview", { kind: "change", path: "old.txt", area: "unstaged" }, { ...repository, changes: [...repository.changes, { path: "old.txt", originalPath: null, indexStatus: " ", worktreeStatus: "M", conflicted: false }] })
  try {
    const stale = lastRequest()
    await view.update({ selection: { kind: "change", path: "notes.txt", area: "staged" } })
    assert.equal(stale.signal?.aborted, true)
    const current = lastRequest()
    assert.equal(current.url.searchParams.get("area"), "staged")
    await respond(current, { path: "notes.txt", oldPath: null, area: "staged", oldLabel: "HEAD", newLabel: "Index", patch: "@@ -1 +1 @@\n-old\n+staged text\n", oldContent: "old", newContent: "staged text", binary: false, truncated: false })
    await respond(stale, { path: "old.txt", area: "unstaged", oldLabel: "Index", newLabel: "Working tree", patch: "wrong stale response", oldContent: "", newContent: "WRONG", binary: false, truncated: false })
    assert.ok(!view.host.textContent?.includes("wrong stale response"))
    await view.click('[role="tab"][data-tabs-value="source"]')
    assert.match(view.host.textContent ?? "", /staged text/)
    const open = [...view.host.querySelectorAll("button")].find((button) => button.textContent === "Open file")!
    await act(async () => open.click())
    assert.deepEqual(view.opened, ["/repo/notes.txt"])
    await view.update({ active: false })
    assert.equal(current.signal?.aborted, true)
  } finally { await view.close() }
})

test("commit details drive file diff requests; binary and truncation states remain explicit", async () => {
  const id = "b".repeat(40)
  const view = await mount("preview", { kind: "commit", commitId: id })
  try {
    assert.equal(lastRequest().url.pathname, "/api/sandbox/git/commit")
    await respond(lastRequest(), { commit: { id, shortId: "bbbbbbb", parents: [], subject: "Add assets", body: "", authorName: "Dev", authoredAt: "2026-10-24T00:00:00Z" }, files: [{ path: "logo.png", originalPath: null, status: "A", additions: null, deletions: null }] })
    assert.equal(lastRequest().url.searchParams.get("path"), "logo.png")
    assert.equal(lastRequest().url.searchParams.get("commit"), id)
    await respond(lastRequest(), { path: "logo.png", oldPath: null, area: "commit", oldLabel: "Empty tree", newLabel: "bbbbbbb", patch: "Binary files differ", oldContent: null, newContent: null, binary: true, truncated: true })
    assert.match(view.host.textContent ?? "", /Binary file/)
    assert.match(view.host.textContent ?? "", /preview is truncated/)
    await view.update({ repository: null })
    assert.ok(!view.host.textContent?.includes("Add assets"))
  } finally { await view.close() }
})

test("staging follows the moved comparison and committing clears its diff without a stale request", async () => {
  const unstaged = { ...repository, changes: [{ path: "notes.txt", originalPath: null, indexStatus: " ", worktreeStatus: "M", conflicted: false }] }
  const view = await mount("preview", { kind: "change", path: "notes.txt", area: "unstaged" }, unstaged)
  try {
    const initialRequest = lastRequest()
    await view.update({ repository: { ...unstaged, changes: [{ ...unstaged.changes[0], indexStatus: "M", worktreeStatus: " " }] } })
    assert.equal(initialRequest.signal?.aborted, true)
    assert.deepEqual(view.selection, { kind: "change", path: "notes.txt", area: "staged" })
    assert.equal(lastRequest().url.searchParams.get("area"), "staged")
    await respond(lastRequest(), { path: "notes.txt", oldPath: null, area: "staged", oldLabel: "HEAD", newLabel: "Index", patch: "@@ -1 +1 @@\n-old\n+staged\n", oldContent: "old", newContent: "staged", binary: false, truncated: false })
    const count = requests.length
    await view.update({ repository: { ...unstaged, changes: [] } })
    assert.equal(requests.length, count)
    assert.match(view.host.textContent ?? "", /no longer has changes/)
    assert.ok(!view.host.textContent?.includes("HEAD → Index"))
  } finally { await view.close() }
})
