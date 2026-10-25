import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { MotionConfig } from "motion/react"
import i18n from "../../../src/i18n"
import "../../../src/index.css"
import { TooltipProvider } from "../../../src/components/ui/tooltip"
import { FileBrowserPage } from "../../../src/features/file-browser/file-browser-page"
import { UploadQueueProvider } from "../../../src/features/uploads/upload-queue-provider"
import { dispatchGitUpdated, type GitActionInput, type GitChange, type GitCommit, type GitDiff, type GitRepository } from "../../../src/lib/api/git-repository"

const params = new URLSearchParams(location.search)
const host = document.querySelector<HTMLDivElement>("#page")!
const output = document.querySelector<HTMLPreElement>("#results")!
const scenarioControl = document.querySelector<HTMLSelectElement>("#scenario")!
const root = createRoot(host)
const fixtureRoot = "/workspace/repo"
const deepDirectory = `${fixtureRoot}/src/features/components/deep`
const zh = params.has("zh")
const label = (en: string, chinese: string) => zh ? chinese : en
document.documentElement.classList.toggle("dark", params.has("dark"))
await i18n.changeLanguage(zh ? "zh-CN" : "en")
if (params.has("reduced-motion")) {
  const originalMatchMedia = window.matchMedia.bind(window)
  window.matchMedia = (query) => query.includes("prefers-reduced-motion")
    ? Object.assign(new EventTarget(), { matches: true, media: query, onchange: null, addListener() {}, removeListener() {} }) as MediaQueryList
    : originalMatchMedia(query)
}

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))
const copy = <T,>(value: T): T => structuredClone(value)
const change = (path: string, indexStatus: string, worktreeStatus: string, originalPath: string | null = null): GitChange => ({ path, indexStatus, worktreeStatus, originalPath, conflicted: false })
const initialChanges = [change("src/app.ts", "M", "M"), change("README.md", "M", " "), change("notes.txt", "?", "?"), change("legacy.txt", " ", "D"), change("docs/guide.md", "R", " ", "docs/old-guide.md")]
const sourceBefore = 'export const title = "Workspace"\nexport const count = 1\n'
const sourceStaged = 'export const title = "Git workspace"\nexport const count = 1\n'
const sourceAfter = 'export const title = "Git workspace"\nexport const count = 2\n'
const contents: Record<string, string> = { "src/app.ts": sourceAfter, "src/clean.ts": "export const ready = true\n", "README.md": "# Git workspace\n\nShared files and Git views.\n", "notes.txt": "Follow up on the Git workspace.\n", "docs/guide.md": "# Guide\nReview changes before committing.\n" }
let repository: GitRepository
let commits: GitCommit[]
let scenario = "normal"
let mountVersion = 0
const actions: GitActionInput[] = []
const calls: string[] = []
function resetFixtures() {
  actions.length = 0
  calls.length = 0
  repository = { cwd: fixtureRoot, root: fixtureRoot, branch: "main", commit: "a".repeat(40), upstream: "origin/main", remote: "origin", remotes: ["origin", "backup"], ahead: 1, behind: 2, operation: null, changes: copy(initialChanges), branches: [
    { name: "main", current: true, remote: false, upstream: "origin/main" },
    { name: "feature/sidebar", current: false, remote: false, upstream: "origin/feature/sidebar" },
    { name: "origin/main", current: false, remote: true, upstream: null },
    { name: "origin/feature/sidebar", current: false, remote: true, upstream: null },
  ] }
  commits = [
    { id: "a".repeat(40), shortId: "aaaaaaa", parents: ["b".repeat(40)], subject: "Polish workspace file navigation", body: "Keep file navigation available alongside repository changes.", authorName: "Fixture author", authoredAt: "2026-10-24T03:20:00.000Z" },
    { id: "b".repeat(40), shortId: "bbbbbbb", parents: [], subject: "Create workspace", body: "", authorName: "Fixture author", authoredAt: "2026-10-23T09:15:00.000Z" },
  ]
}
resetFixtures()

function fileEntry(path: string, directory: boolean) {
  return { path, name: path.split("/").at(-1)!, type: directory ? "directory" : "file", size: directory ? null : 100, modified: null, permissions: null }
}
function list(path: string) {
  const entries = path === "/workspace" ? [fileEntry(fixtureRoot, true)] : path === fixtureRoot
    ? [fileEntry(`${path}/src`, true), fileEntry(`${path}/docs`, true), fileEntry(`${path}/README.md`, false), fileEntry(`${path}/notes.txt`, false)]
    : path === `${fixtureRoot}/src` ? [fileEntry(`${path}/app.ts`, false), fileEntry(`${path}/clean.ts`, false), fileEntry(`${path}/features`, true)]
    : path === `${fixtureRoot}/docs` ? [fileEntry(`${path}/guide.md`, false)]
    : deepDirectory.startsWith(`${path}/`) ? [fileEntry(`${path}/${deepDirectory.slice(path.length + 1).split("/")[0]}`, true)] : []
  return { root: "/workspace", path, parent: path === "/workspace" ? null : path.slice(0, path.lastIndexOf("/")), entries }
}
function snapshot(cwd: string) {
  return scenario === "nonrepo" || !cwd.startsWith(fixtureRoot)
    ? { ...repository, cwd, root: null, branch: null, commit: null, changes: [], branches: [], remotes: [], upstream: null, remote: null }
    : { ...copy(repository), cwd }
}
function diff(path: string, area: GitDiff["area"]): GitDiff {
  const isSource = path === "src/app.ts"
  const oldContent = area === "untracked" ? null : isSource ? area === "unstaged" ? sourceStaged : sourceBefore : "Previous content\n"
  const newContent = path === "legacy.txt" ? null : isSource ? area === "staged" ? sourceStaged : sourceAfter : contents[path] ?? "Updated content\n"
  return { path, oldPath: path === "docs/guide.md" ? "docs/old-guide.md" : null, area, oldLabel: area === "unstaged" ? "Index" : "HEAD", newLabel: area === "staged" ? "Index" : area === "commit" ? "Commit" : "Working tree", oldContent, newContent, binary: false, truncated: false,
    patch: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,${oldContent?.trimEnd().split("\n").length ?? 0} +1,${newContent?.trimEnd().split("\n").length ?? 0} @@\n${oldContent ? oldContent.trimEnd().split("\n").map((line) => `-${line}`).join("\n") + "\n" : ""}${newContent ? newContent.trimEnd().split("\n").map((line) => `+${line}`).join("\n") + "\n" : ""}` }
}
function applyAction(input: GitActionInput) {
  if (input.action === "stage" || input.action === "unstage") {
    for (const item of repository.changes.filter((entry) => input.paths?.includes(entry.path))) {
      if (input.action === "stage") {
        item.indexStatus = item.indexStatus === "?" ? "A" : item.worktreeStatus === "D" ? "D" : item.indexStatus === "R" ? "R" : "M"
        item.worktreeStatus = " "
        item.conflicted = false
      } else {
        item.worktreeStatus = item.indexStatus === "A" ? "?" : item.indexStatus === "R" ? "R" : "M"
        item.indexStatus = item.indexStatus === "A" ? "?" : " "
      }
    }
  } else if (input.action === "switch") {
    repository.branch = input.branch!
    repository.branches.forEach((branch) => { branch.current = branch.name === input.branch })
    repository.upstream = repository.branches.find((branch) => branch.current)?.upstream ?? null
  } else if (input.action === "set-upstream") {
    repository.upstream = input.branch!
    repository.remote = repository.remotes.find((remote) => input.branch!.startsWith(`${remote}/`)) ?? null
    repository.branches.forEach((branch) => { if (branch.current) branch.upstream = input.branch! })
  }
}

const nativeFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href)
  if (!url.pathname.startsWith("/api/")) return nativeFetch(input, init)
  calls.push(url.pathname)
  await wait(init?.method === "POST" ? 100 : 35)
  if (init?.signal?.aborted) throw new DOMException("Canceled", "AbortError")
  if (url.pathname === "/api/sandbox/files/list") return Response.json(list(url.searchParams.get("path") ?? "/workspace"))
  if (url.pathname === "/api/sandbox/files/preview") {
    const path = url.searchParams.get("path")!
    return Response.json({ path, name: path.split("/").at(-1), mime_type: "text/plain", size: 100, content: contents[path.slice(fixtureRoot.length + 1)] ?? "Fixture file\n", is_binary: false, preview_url: null, preview_error: null })
  }
  if (url.pathname === "/api/sandbox/files/exists") return Response.json({ exists: {} })
  if (url.pathname === "/api/sandbox/git/repository") return scenario === "error" ? Response.json({ detail: "Fixture: repository temporarily unavailable" }, { status: 503 }) : Response.json(snapshot(url.searchParams.get("cwd")!))
  if (url.pathname === "/api/sandbox/git/history") return Response.json({ commits, hasMore: false })
  if (url.pathname === "/api/sandbox/git/commit") return Response.json({ commit: commits.find((commit) => commit.id === url.searchParams.get("commit")) ?? commits[0], files: [{ path: "src/app.ts", originalPath: null, status: "M", additions: 2, deletions: 2 }, { path: "README.md", originalPath: null, status: "M", additions: 1, deletions: 1 }] })
  if (url.pathname === "/api/sandbox/git/diff") return Response.json(diff(url.searchParams.get("path")!, url.searchParams.get("area") as GitDiff["area"]))
  if (url.pathname === "/api/sandbox/git/action") {
    const action = JSON.parse(String(init?.body)) as GitActionInput
    if (action.expectedBranch !== repository.branch || action.expectedCommit !== repository.commit) return Response.json({ detail: "Fixture HEAD changed. Refresh and retry." }, { status: 409 })
    actions.push(copy(action))
    applyAction(action)
    return Response.json({ repository: snapshot(action.cwd), message: `Fixture ${action.action} completed` })
  }
  return Response.json({ detail: `Unmocked fixture endpoint: ${url.pathname}` }, { status: 404 })
}

function render() {
  flushSync(() => root.render(<MotionConfig reducedMotion={params.has("reduced-motion") ? "always" : "user"}><TooltipProvider><UploadQueueProvider><FileBrowserPage key={mountVersion} compact={params.has("compact")} initialDirectory={fixtureRoot} /></UploadQueueProvider></TooltipProvider></MotionConfig>))
}
function setWidth(narrow: boolean) { host.style.width = narrow ? "390px" : "1300px" }
function setScenario(next: string) {
  scenario = next
  scenarioControl.value = next
  if (next === "conflict") {
    repository.operation = "merge"
    repository.changes = [{ ...change("src/app.ts", "U", "U"), conflicted: true }, ...copy(initialChanges.filter((item) => item.path !== "src/app.ts"))]
  } else if (next === "normal") resetFixtures()
  dispatchGitUpdated({ cwd: fixtureRoot, root: fixtureRoot })
}
document.querySelector("#wide")!.addEventListener("click", () => setWidth(false))
document.querySelector("#narrow")!.addEventListener("click", () => setWidth(true))
scenarioControl.addEventListener("change", () => setScenario(scenarioControl.value))
if (params.has("narrow")) setWidth(true)
render()

async function until<T>(ready: () => T, description: string): Promise<NonNullable<T>> {
  const start = performance.now()
  while (true) {
    const value = ready()
    if (value) return value as NonNullable<T>
    if (performance.now() - start > 10000) throw new Error(`Timed out: ${description}`)
    await wait()
  }
}
const visible = (element: Element | null | undefined): element is Element => Boolean(element && element.getClientRects().length > 0 && !element.closest("[inert]"))
const buttons = (scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>("button")].filter(visible)
const button = (text: string, scope: ParentNode = document) => buttons(scope).find((item) => item.textContent?.trim() === text)
const named = (name: string) => buttons().find((item) => item.getAttribute("aria-label") === name)
const tabText = (item: HTMLButtonElement) => [...item.childNodes].filter((node) => !(node instanceof Element && node.getAttribute("aria-hidden") === "true")).map((node) => node.textContent).join("").trim()
const tab = (text: string | RegExp) => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((item) => visible(item) && (typeof text === "string" ? tabText(item) === text : text.test(tabText(item))))
const viewTabs = () => host.querySelector<HTMLElement>("[data-file-browser-view-tabs]")
const gitTab = () => viewTabs()?.querySelector<HTMLButtonElement>('[data-tabs-value="git"]')
const filesTab = () => viewTabs()?.querySelector<HTMLButtonElement>('[data-tabs-value="files"]')
const workspace = () => host.querySelector<HTMLElement>("[data-git-workspace]")!
const gitHeader = () => host.querySelector<HTMLElement>("[data-git-repository-header]")
function fill(element: HTMLInputElement, value: string) {
  element.focus()
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value)
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }))
  element.dispatchEvent(new Event("change", { bubbles: true }))
}
async function returnToList() { const back = named(label("Back to Git", "返回 Git")); if (back) { back.click(); await wait(100) } }
async function goTo(path: string) {
  named(label("Go to directory", "前往目录"))!.click()
  const input = await until(() => host.querySelector<HTMLInputElement>(`input[aria-label="${label("Go to directory", "前往目录")}"]`), "go-to input")
  await until(() => document.activeElement === input, "go-to focus")
  fill(input, path)
  await wait()
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  await until(() => !host.contains(input), `navigate to ${path}`)
}

async function runChecks() {
  const control = document.querySelector<HTMLButtonElement>("#run")!
  control.disabled = true
  output.textContent = "Running…"
  const checks: string[] = []
  const check = (name: string, condition: unknown) => { if (!condition) throw new Error(name); checks.push(`PASS ${name}`) }
  try {
    scenario = "normal"
    scenarioControl.value = scenario
    resetFixtures()
    setWidth(false)
    mountVersion++
    render()
    const repoRow = await until(() => {
      const row = host.querySelector<HTMLButtonElement>('[data-file-tree-item-id="/workspace/repo"]')
      return visible(row) && gitTab() ? row : null
    }, "initial files and repository")
    check("View tabs sit immediately before Create folder", viewTabs()!.nextElementSibling?.getAttribute("aria-label") === label("Create folder", "新建文件夹"))
    check("Files is selected initially", filesTab()!.getAttribute("aria-selected") === "true" && gitTab()!.getAttribute("aria-selected") === "false")
    if (repoRow.getAttribute("aria-expanded") !== "true") repoRow.click()
    const src = await until(() => {
      const row = host.querySelector<HTMLButtonElement>('[data-file-tree-item-id="/workspace/repo/src"]')
      return visible(row) ? row : null
    }, "expanded repository")
    src.click()
    await until(() => host.querySelector('[data-file-tree-item-id="/workspace/repo/src/app.ts"] [data-git-status="M"]'), "file decoration")
    check("Files mode decorates modified files and their ancestor directories", Boolean(src.querySelector('[data-git-status="."]')))
    await until(gitTab, "repository tabs in a child directory")
    check("Child directories keep the view tabs in the address bar", visible(viewTabs()))
    const tabsLeft = viewTabs()!.getBoundingClientRect().left
    gitTab()!.click()
    await until(() => visible(gitHeader()), "Git changes")
    check("Git has no commit form or footer", !workspace().querySelector('form, textarea, button[type="submit"]'))
    check("Git omits Pull, Push, and Publish controls", !buttons(host).some((item) => [label("Pull", "拉取"), label("Push", "推送"), label("Publish branch", "发布分支")].some((text) => item.textContent?.trim().startsWith(text))))
    named(`${label("Select remote branch", "选择远程分支")}: origin/main`)!.click()
    await until(() => document.querySelector('[data-slot="popover-content"] button[title="origin/feature/sidebar"]'), "remote branch menu")
    check("The remote dropdown excludes local branches", !document.querySelector('[data-slot="popover-content"] button[title="main"]'))
    button("origin/feature/sidebar", document.querySelector('[data-slot="popover-content"]')!)!.click()
    await until(() => named(`${label("Select remote branch", "选择远程分支")}: origin/feature/sidebar`), "upstream updated")
    check("Remote selection updates upstream while keeping the local branch", actions.at(-1)?.action === "set-upstream" && repository.branch === "main")
    check("Git activation keeps the address bar tabs in place", Math.abs(viewTabs()!.getBoundingClientRect().left - tabsLeft) < 1 && gitTab()!.getAttribute("aria-selected") === "true")
    check("Partially staged file appears independently in staged and unstaged groups", buttons(host).filter((item) => item.title === "src/app.ts").length === 2)
    filesTab()!.click()
    await until(() => visible(src), "Files view")
    gitTab()!.click()
    await until(() => visible(gitHeader()), "Git view returns")
    check("Change groups survive Files / Git switching", buttons(host).filter((item) => item.title === "src/app.ts").length === 2)
    setWidth(true)
    await until(() => workspace().dataset.narrow === "true", "narrow container")
    check("Narrow mode keeps both view tabs visible", visible(viewTabs()) && viewTabs()!.getBoundingClientRect().right <= host.getBoundingClientRect().right)
    buttons(host).find((item) => item.title === "src/app.ts")!.click()
    await until(() => named(label("Back to Git", "返回 Git")) && host.querySelector(`[aria-label="${label("Diff", "差异")}: src/app.ts"]`), "single-column diff")
    check("Narrow mode hides the list from keyboard focus while showing a diff", Boolean(gitHeader()!.closest("[inert]")))
    check("Narrow diff occupies the complete container without an empty tree column", workspace().querySelector<HTMLElement>('[data-git-hidden="true"]')!.getBoundingClientRect().width === 0 && workspace().querySelector<HTMLElement>('[data-git-full="true"]')!.getBoundingClientRect().width >= workspace().clientWidth - 2)
    await returnToList()
    check("Returning to the narrow list restores its complete container width", workspace().querySelector<HTMLElement>('[data-git-full="true"]')!.getBoundingClientRect().width >= workspace().clientWidth - 2)
    check("Selection survives narrow diff navigation", buttons(host).some((item) => item.title === "src/app.ts" && item.getAttribute("aria-pressed") === "true"))
    setWidth(false)
    await until(() => workspace().dataset.narrow === "false", "wide container")
    named(`${label("Stage file", "暂存文件")}: src/app.ts`)!.click()
    await until(() => repository.changes[0].worktreeStatus === " " && !named(`${label("Stage file", "暂存文件")}: src/app.ts`), "stage file")
    check("Stage sends only the selected path", actions.at(-1)?.paths?.join() === "src/app.ts")
    named(`${label("Unstage file", "取消暂存")}: src/app.ts`)!.click()
    await until(() => repository.changes[0].indexStatus === " " && named(`${label("Stage file", "暂存文件")}: src/app.ts`), "unstage file")
    check("Unstage preserves the working change", repository.changes[0].worktreeStatus === "M")
    named(`${label("Stage file", "暂存文件")}: src/app.ts`)!.click()
    await until(() => named(`${label("Unstage file", "取消暂存")}: src/app.ts`), "restage file")
    buttons().find((item) => item.getAttribute("aria-label")?.startsWith(label("Switch branch:", "切换分支：").replace("：", ":")))!.click()
    await until(() => button("feature/sidebar"), "branch menu")
    check("The local branch menu has no Create branch action", !button(label("Create branch", "创建分支")))
    button("feature/sidebar")!.click()
    await until(() => repository.branch === "feature/sidebar" && !document.querySelector('[data-slot="popover-content"]'), "switch branch")
    check("Branch switching uses the shared controller", actions.at(-1)?.action === "switch")
    const remoteMenuLabel = `${label("Select remote branch", "选择远程分支")}: origin/feature/sidebar`
    named(remoteMenuLabel)!.click()
    await until(() => named(label("Fetch", "获取远端更新")), "remote dropdown Fetch")
    named(label("Fetch", "获取远端更新"))!.click()
    await until(() => actions.at(-1)?.action === "fetch" && !named(label("Fetch", "获取远端更新"))?.disabled, "fetch settled")
    check("Fetch remains available in the remote dropdown after switching branches", actions.at(-1)?.action === "fetch")
    named(remoteMenuLabel)!.click()
    tab(label("History", "历史"))!.click()
    const historySubject = commits[0].subject
    await until(() => buttons(host).find((item) => item.textContent?.includes(historySubject)), "history")
    buttons(host).find((item) => item.textContent?.includes(historySubject))!.click()
    await until(() => host.querySelector(`[aria-label="${label("Diff", "差异")}: src/app.ts"]`) && host.textContent?.includes(label("Changed files", "变更文件")), "commit details")
    check("History opens commit files and immutable diff", calls.includes("/api/sandbox/git/commit"))
    tab(label("Source", "源码"))!.click()
    await until(() => host.querySelector(`[aria-label="${label("Source", "源码")}: src/app.ts"]`)?.textContent?.includes("count = 2"), "source preview")
    check("Diff / Source switches to file content", Boolean(tab(label("Diff", "差异"))))
    tab(label("Changes", "变更"))!.click()
    setScenario("conflict")
    await until(() => host.textContent?.includes(label("Merge in progress", "合并正在进行")), "conflict state")
    check("Conflicts remain visible with recovery guidance", buttons(host).some((item) => item.textContent?.includes(label("Conflicts", "冲突"))))
    setScenario("error")
    await until(() => host.textContent?.includes("Fixture: repository temporarily unavailable"), "read error")
    check("Repository failures offer retry", Boolean(button(label("Retry", "重试"))))
    check("A refresh failure retains the tab for returning to files", visible(filesTab()) && gitTab()!.getAttribute("aria-selected") === "true")
    setScenario("normal")
    await until(() => visible(gitHeader()), "recover fixture")
    check("Fixture recovery restores Git controls", Boolean(named(label("Refresh Git", "刷新 Git"))))
    await goTo(deepDirectory)
    await until(gitTab, "deep repository tabs")
    check("Long paths keep the view tabs outside collapsed menus", visible(viewTabs()))
    setWidth(true)
    await until(() => workspace().dataset.narrow === "true", "deep narrow container")
    check("Deep narrow breadcrumbs retain view tabs and current directory", visible(viewTabs()) && host.querySelector('[aria-current="location"]')?.textContent === "deep" && viewTabs()!.getBoundingClientRect().right <= host.getBoundingClientRect().right)
    await goTo("/workspace")
    await until(() => !viewTabs() && !visible(workspace()), "leave repository")
    check("Leaving the repository hides the tabs and restores files", visible(host.querySelector('[data-file-tree-item-id="/workspace/repo"]')))
    await goTo(fixtureRoot)
    await until(gitTab, "return to repository")
    check("Returning to a repository leaves files selected until explicitly changed", filesTab()!.getAttribute("aria-selected") === "true")
    gitTab()!.click()
    await until(() => visible(gitHeader()), "open Git before repository removal")
    setScenario("nonrepo")
    await until(() => !viewTabs() && !visible(workspace()), "non-repository state")
    check("A directory that ceases to be a repository hides its Git control", !visible(gitHeader()))
    output.textContent = `${checks.join("\n")}\nPASS: ${checks.length} checks. Compact=${params.has("compact")}, language=${zh ? "zh" : "en"}.`
  } catch (error) {
    output.textContent = `${checks.join("\n")}\nFAIL after ${checks.length} checks: ${String(error)}`
    console.error(error)
  } finally { control.disabled = false }
}
document.querySelector("#run")!.addEventListener("click", () => void runChecks())
if (params.has("auto")) void runChecks()
