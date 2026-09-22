import assert from "node:assert/strict"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"
import type { GitStatus } from "../../../src/lib/api/git-status.ts"
import type { ProjectGitStatusOptions } from "../../../src/features/agent-message/use-project-git-status.ts"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "DocumentFragment", "ShadowRoot", "SVGElement", "Event", "FocusEvent", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})
dom.window.matchMedia = (query) => ({ matches: true, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, onchange: null })
const originalFetch = globalThis.fetch
type Pending = { cwd: string; signal: AbortSignal; resolve: (response: Response) => void }
const requests: Pending[] = []
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input), "http://localhost")
  assert.equal(url.pathname, "/api/sandbox/git/status")
  assert.equal(init?.cache, "no-store")
  return new Promise<Response>((resolve) => requests.push({ cwd: url.searchParams.get("cwd")!, signal: init?.signal as AbortSignal, resolve }))
}
after(() => { dom.window.close(); globalThis.fetch = originalFetch })

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { MotionConfig } = await import("motion/react")
const { I18nextProvider, initReactI18next } = await import("react-i18next")
const i18n = (await import("i18next")).createInstance()
const { en } = await import("../../../src/i18n/locales/en.ts")
const { zhCN } = await import("../../../src/i18n/locales/zh-CN.ts")
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en }, "zh-CN": { translation: zhCN } } })
const { TooltipProvider } = await import("../../../src/components/ui/tooltip.tsx")
const { SessionGitIndicator } = await import("../../../src/features/agent-message/components/session-git-indicator.tsx")

const latest = () => requests.at(-1)!
const status = (cwd: string, branch: string | null, commit: string | null = "a1b2c3d"): GitStatus => ({ cwd, root: cwd, branch, commit })
const respond = async (request: Pending, payload: GitStatus | { detail: string }, code = 200) => {
  await act(async () => request.resolve(Response.json(payload, { status: code })))
}

async function mount(initial: Partial<ProjectGitStatusOptions> = {}) {
  requests.length = 0
  await i18n.changeLanguage("en")
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  let options: ProjectGitStatusOptions = { cwd: "/workspace/project & demo", sessionId: null, isStreaming: false, ...initial }
  const update = async (next: Partial<ProjectGitStatusOptions>) => {
    options = { ...options, ...next }
    await act(async () => root.render(<React.StrictMode><I18nextProvider i18n={i18n}><MotionConfig reducedMotion="always"><TooltipProvider>
      <SessionGitIndicator {...options} />
    </TooltipProvider></MotionConfig></I18nextProvider></React.StrictMode>))
  }
  await update({})
  return { host, update, close: async () => { await act(async () => root.unmount()); host.remove() } }
}

test("a draft displays the branch and refreshes after a run, focus, and a session change", async () => {
  const view = await mount()
  try {
    assert.equal(view.host.textContent, "")
    assert.equal(latest().cwd, "/workspace/project & demo")
    await respond(latest(), status(latest().cwd, "main", null))
    assert.ok(view.host.querySelector('[aria-label="Git branch: main"]'))

    await view.update({ isStreaming: true })
    await respond(latest(), status(latest().cwd, "main"))
    const runningRequest = latest()
    await view.update({ isStreaming: false })
    assert.notEqual(latest(), runningRequest)
    await respond(latest(), status(latest().cwd, "feature/finished"))
    assert.equal(view.host.textContent, "feature/finished")

    await act(async () => window.dispatchEvent(new Event("focus")))
    await respond(latest(), status(latest().cwd, null))
    assert.ok(view.host.querySelector('[aria-label="Detached HEAD: a1b2c3d"]'))
    const beforeSwitch = latest()
    await view.update({ sessionId: "another-session" })
    assert.notEqual(latest(), beforeSwitch)
    await respond(latest(), status(latest().cwd, "another-branch"))
    assert.equal(view.host.textContent, "another-branch")
  } finally { await view.close() }
})

test("directory changes hide old labels, cancel requests, and discard late responses", async () => {
  const view = await mount({ cwd: "/workspace/a" })
  try {
    const oldRequest = latest()
    await view.update({ cwd: "/workspace/b" })
    assert.equal(oldRequest.signal.aborted, true)
    await respond(latest(), status("/workspace/b", "branch-b"))
    await respond(oldRequest, status("/workspace/a", "branch-a"))
    assert.equal(view.host.textContent, "branch-b")
    await view.update({ cwd: "/workspace/plain" })
    assert.equal(view.host.textContent, "")
    await respond(latest(), { cwd: "/workspace/plain", root: null, branch: null, commit: null })
    assert.equal(view.host.textContent, "")
  } finally { await view.close() }
  assert.equal(latest().signal.aborted, true)
})

test("failed reads replace stale metadata with an accessible retry and recover", async () => {
  const view = await mount()
  try {
    await respond(latest(), status(latest().cwd, "main"))
    await act(async () => window.dispatchEvent(new Event("focus")))
    await respond(latest(), { detail: "Check repository access" }, 500)
    assert.equal(view.host.textContent, "Git unavailable")
    const beforeRetry = latest()
    await act(async () => view.host.querySelector<HTMLButtonElement>('[aria-label="Retry Git status"]')!.click())
    assert.notEqual(latest(), beforeRetry)
    await respond(latest(), status(latest().cwd, null))
    await act(async () => { await i18n.changeLanguage("zh-CN") })
    assert.ok(view.host.querySelector('[aria-label="分离 HEAD：a1b2c3d"]'))
  } finally { await view.close() }
})

test("hidden views stop querying and becoming visible refreshes Git status", async () => {
  const view = await mount({ enabled: false })
  try {
    assert.equal(requests.length, 0)
    await view.update({ enabled: true })
    await respond(latest(), status(latest().cwd, "main"))
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" })
    const beforeHidden = requests.length
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
      window.dispatchEvent(new Event("focus"))
    })
    assert.equal(requests.length, beforeHidden)
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" })
    await act(async () => document.dispatchEvent(new Event("visibilitychange")))
    assert.equal(requests.length, beforeHidden + 1)
    await respond(latest(), status(latest().cwd, "visible-branch"))
    assert.equal(view.host.textContent, "visible-branch")
    await view.update({ enabled: false })
    const beforeDisabled = requests.length
    await act(async () => window.dispatchEvent(new Event("focus")))
    assert.equal(requests.length, beforeDisabled)
  } finally {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" })
    await view.close()
  }
})
