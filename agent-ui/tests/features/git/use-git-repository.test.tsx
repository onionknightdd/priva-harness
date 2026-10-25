import assert from "node:assert/strict"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

import type { GitActionInput, GitRepository } from "../../../src/lib/api/git-repository.ts"
import type { GitRepositoryController, GitRepositoryOptions } from "../../../src/features/git/use-git-repository.ts"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const originalFetch = globalThis.fetch
type Pending = { cwd: string; signal?: AbortSignal; body?: GitActionInput; resolve: (response: Response) => void }
const requests: Pending[] = []
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input), "http://localhost")
  const body = init?.body ? JSON.parse(String(init.body)) as GitActionInput : undefined
  assert.ok(["/api/sandbox/git/repository", "/api/sandbox/git/action"].includes(url.pathname))
  return new Promise<Response>((resolve) => requests.push({ cwd: body?.cwd ?? url.searchParams.get("cwd")!, signal: init?.signal as AbortSignal | undefined, body, resolve }))
}
after(() => { dom.window.close(); globalThis.fetch = originalFetch })

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { dispatchGitUpdated } = await import("../../../src/lib/api/git-repository.ts")
const { useGitRepository } = await import("../../../src/features/git/use-git-repository.ts")

const repository = (cwd: string, branch = "main"): GitRepository => ({
  cwd, root: cwd, branch, commit: "a".repeat(40), upstream: "origin/main", remote: "origin", remotes: ["origin"], ahead: 0, behind: 0, operation: null, changes: [], branches: [],
})
const latestRead = () => requests.filter((request) => !request.body).at(-1)!
const latestWrite = () => requests.filter((request) => request.body).at(-1)!
const respond = async (request: Pending, payload: unknown, status = 200) => {
  await act(async () => request.resolve(Response.json(payload, { status })))
}

async function mount(initial: Partial<GitRepositoryOptions> = {}) {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  let options: GitRepositoryOptions = { cwd: "/repo", active: true, ...initial }
  let controller: GitRepositoryController
  function Probe() {
    controller = useGitRepository(options)
    return <div>{controller.repository?.branch ?? ""}</div>
  }
  const update = async (next: Partial<GitRepositoryOptions>) => {
    options = { ...options, ...next }
    await act(async () => root.render(<React.StrictMode><Probe /></React.StrictMode>))
  }
  await update({})
  return { host, update, get controller() { return controller! }, close: async () => { await act(async () => root.unmount()); host.remove() } }
}

test("switching directories cancels stale reads and immediately clears previous repository data", async () => {
  const view = await mount({ cwd: "/repo/a" })
  try {
    await respond(latestRead(), repository("/repo/a", "a"))
    await act(async () => view.controller.refresh())
    const oldRead = latestRead()
    await view.update({ cwd: "/repo/b" })
    assert.equal(view.controller.repository, null)
    assert.equal(oldRead.signal?.aborted, true)
    await respond(latestRead(), repository("/repo/b", "b"))
    await respond(oldRead, repository("/repo/a", "late-a"))
    assert.equal(view.controller.repository?.branch, "b")
    assert.equal(view.controller.loading, false)
  } finally { await view.close() }
})

test("refresh, focus and same-repository events supersede stale reads without polling", async () => {
  const view = await mount({ cwd: "/repo/subdir" })
  try {
    const first = latestRead()
    await act(async () => window.dispatchEvent(new Event("focus")))
    assert.equal(first.signal?.aborted, true)
    await respond(latestRead(), { ...repository("/repo/subdir"), root: "/repo" })
    const count = requests.length
    await act(async () => dispatchGitUpdated({ cwd: "/elsewhere", root: "/elsewhere" }))
    assert.equal(requests.length, count)
    await act(async () => dispatchGitUpdated({ cwd: "/repo", root: "/repo" }))
    assert.equal(requests.length, count + 1)
    await respond(latestRead(), { ...repository("/repo/subdir", "updated"), root: "/repo" })
    await respond(first, repository("/repo/subdir", "stale"))
    assert.equal(view.controller.repository?.branch, "updated")
  } finally { await view.close() }
})

test("hidden views abort reads and resume when visible without background requests", async () => {
  const before = requests.length
  const view = await mount({ active: false })
  try {
    assert.equal(requests.length, before)
    await view.update({ active: true })
    const pending = latestRead()
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" })
    await act(async () => document.dispatchEvent(new Event("visibilitychange")))
    assert.equal(pending.signal?.aborted, true)
    const hiddenCount = requests.length
    await act(async () => { view.controller.refresh(); window.dispatchEvent(new Event("focus")); dispatchGitUpdated({ cwd: "/repo", root: "/repo" }) })
    assert.equal(requests.length, hiddenCount)
    await respond(pending, repository("/repo", "hidden-response"))
    assert.equal(view.controller.repository, null)
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" })
    await act(async () => document.dispatchEvent(new Event("visibilitychange")))
    await respond(latestRead(), repository("/repo", "visible"))
    assert.equal(view.controller.repository?.branch, "visible")
    await view.update({ active: false })
    const inactiveCount = requests.length
    await act(async () => window.dispatchEvent(new Event("focus")))
    assert.equal(requests.length, inactiveCount)
  } finally {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" })
    await view.close()
  }
})

test("mutations prevent double submission, guard the loaded HEAD, and refresh after a failed pull", async () => {
  let mutations = 0
  const view = await mount({ onMutation: () => { mutations++ } })
  try {
    await respond(latestRead(), repository("/repo"))
    let result!: Promise<boolean>
    await act(async () => { result = view.controller.perform({ action: "pull" }) })
    const write = latestWrite()
    assert.equal(write.signal, undefined)
    assert.equal(write.body?.expectedBranch, "main")
    assert.equal(write.body?.expectedCommit, "a".repeat(40))
    assert.equal(view.controller.busy, "pull")
    const count = requests.length
    assert.equal(await view.controller.perform({ action: "pull" }), false)
    assert.equal(requests.length, count)
    await respond(write, { detail: "Resolve the merge conflict before retrying." }, 409)
    assert.equal(await result, false)
    assert.equal(view.controller.busy, null)
    assert.match(view.controller.actionError!, /merge conflict/)
    assert.equal(mutations, 1)
    assert.equal(requests.length, count + 1)
    await respond(latestRead(), { ...repository("/repo"), operation: "merge" })
    assert.equal(view.controller.repository?.operation, "merge")
    assert.match(view.controller.actionError!, /merge conflict/)
  } finally { await view.close() }
})

test("navigation does not cancel an in-flight write or apply its result to another directory", async () => {
  let mutations = 0
  const view = await mount({ cwd: "/repo/a", onMutation: () => { mutations++ } })
  try {
    await respond(latestRead(), repository("/repo/a", "a"))
    let result!: Promise<boolean>
    await act(async () => { result = view.controller.perform({ action: "switch", branch: "feature" }) })
    const write = latestWrite()
    await view.update({ cwd: "/repo/b" })
    assert.equal(view.controller.repository, null)
    assert.equal(write.signal, undefined)
    await respond(write, { repository: repository("/repo/a", "feature"), message: "Switched branch" })
    assert.equal(await result, true)
    assert.equal(view.controller.repository, null)
    assert.equal(view.controller.actionMessage, null)
    assert.equal(view.controller.busy, null)
    assert.equal(mutations, 0)
    assert.equal(latestRead().cwd, "/repo/b")
    await respond(latestRead(), repository("/repo/b", "b"))
    assert.equal(view.controller.repository?.branch, "b")
  } finally { await view.close() }
})

test("successful actions notify other views and failed reads replace stale metadata with a retryable error", async () => {
  let mutations = 0
  const first = await mount({ onMutation: () => { mutations++ } })
  await respond(latestRead(), repository("/repo"))
  const second = await mount()
  try {
    await respond(latestRead(), repository("/repo"))
    let result!: Promise<boolean>
    await act(async () => { result = first.controller.perform({ action: "commit", message: "Save changes" }) })
    const count = requests.length
    await respond(latestWrite(), { repository: repository("/repo", "committed"), message: "Committed changes" })
    assert.equal(await result, true)
    assert.equal(mutations, 1)
    assert.equal(first.controller.actionMessage, "Committed changes")
    assert.equal(requests.length, count + 2)
    for (const request of requests.slice(count)) await respond(request, repository("/repo", "updated"))
    assert.equal(first.controller.repository?.branch, "updated")
    assert.equal(second.controller.repository?.branch, "updated")
    await act(async () => first.controller.refresh())
    await respond(latestRead(), { detail: "Repository unavailable" }, 500)
    assert.equal(first.controller.repository, null)
    assert.equal(first.controller.error, "Repository unavailable")
    await act(async () => first.controller.refresh())
    await respond(latestRead(), repository("/repo", "recovered"))
    assert.equal(first.controller.repository?.branch, "recovered")
    assert.equal(first.controller.error, null)
  } finally { await first.close(); await second.close() }
})
