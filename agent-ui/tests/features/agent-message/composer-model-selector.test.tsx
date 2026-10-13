import type { ContextWindow } from "../../../src/features/agent-message/model-context.ts"
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"
import type { ComposerEffort } from "../../../src/features/agent-message/components/composer-model-selector.tsx"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "DocumentFragment", "ShadowRoot", "SVGElement", "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "MutationObserver", "getComputedStyle"]) {
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
    if (url === "virtual:visualize-sandbox-runtime") return { format: "module", source: 'export default ""', shortCircuit: true }
    const result = nextLoad(url, context)
    if (url.endsWith("/file-type-icon.tsx")) return { ...result, source: `import.meta.env = { DEV: false, BASE_URL: "/" };\n${result.source}` }
    return result
  },
})
const originalFetch = globalThis.fetch
const profile = { id: "native-profile", label: "Native profile", default_model: "claude-sonnet-4-6",
  base_url: "http://localhost", auth_token_set: true, image_understanding_model: null,
  image_generation_model: null, image_edit_model: null, classifier_api: null, classifier_model: null, classifier_profile_id: null, model_count: 2,
  model_capabilities: { image_understanding: [], image_generation: [], image_edit: [], classification: [] } }
let loadProfiles = async () => Response.json({ profiles: [profile], default_profile_id: profile.id })
const writes: string[] = []
globalThis.fetch = async (input, init) => {
  const url = String(input)
  if (init?.method && init.method !== "GET") writes.push(url)
  if (url === "/api/sandbox/agent/profile") return Response.json({ queue_behavior: "follow-up" })
  if (url === "/api/sandbox/credentials/profiles") return loadProfiles()
  if (url.endsWith("/models")) return Response.json({ models: [{ id: "claude-sonnet-4-6", pi_effort_levels: ["off", "low", "medium", "high"] }, { id: "claude-opus-4-6", pi_effort_levels: ["off", "low", "medium", "high"] }, { id: "deepseek-flash", pi_effort_levels: ["off", "low", "high", "max"] }, { id: "plain-model", pi_effort_levels: ["off"] }] })
  assert.fail(`Unexpected request: ${url}`)
}
after(() => { hooks.deregister(); dom.window.close(); globalThis.fetch = originalFetch })

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { MotionConfig } = await import("motion/react")
const { I18nextProvider, initReactI18next } = await import("react-i18next")
const i18n = (await import("i18next")).createInstance()
const { en } = await import("../../../src/i18n/locales/en.ts")
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } } })
const { AgentPreferencesProvider } = await import("../../../src/features/settings/agent-preferences-context.tsx")
const { ComposerModelSelector } = await import("../../../src/features/agent-message/components/composer-model-selector.tsx")

async function mount(options: { isPi?: boolean; model?: string; effort?: ComposerEffort; effortLevels?: readonly ComposerEffort[] } = {}) {
  dom.window.localStorage.clear()
  writes.splice(0)
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  let state: { modelReference: string | null; effort: ComposerEffort; contextWindow: ContextWindow; effortLevels?: readonly ComposerEffort[] } = { modelReference: options.model ? `${profile.id}:${options.model}` : null, effort: options.effort ?? "medium", contextWindow: 200000, ...(options.effortLevels ? { effortLevels: options.effortLevels } : {}) }
  let setState: React.Dispatch<React.SetStateAction<typeof state>>
  let setVisible: React.Dispatch<React.SetStateAction<boolean>>
  const changes: (string | null)[] = []
  function Fixture() {
    const [value, update] = React.useState(state)
    const [visible, show] = React.useState(true)
    state = value
    setState = update
    setVisible = show
    const onModelReferenceChange = React.useCallback((modelReference: string | null) => {
      changes.push(modelReference)
      update((current) => ({ ...current, modelReference }))
    }, [])
    const onEffortChange = React.useCallback((effort: ComposerEffort) => update((current) => ({ ...current, effort })), [])
    return visible ? <ComposerModelSelector {...value} isPi={options.isPi}
      configurationPending={false} onContextWindowChange={(contextWindow) => update((current) => ({ ...current, contextWindow }))}
      onModelReferenceChange={onModelReferenceChange} onEffortChange={onEffortChange} /> : null
  }
  await act(async () => root.render(<React.StrictMode><I18nextProvider i18n={i18n}><MotionConfig reducedMotion="always">
    <AgentPreferencesProvider><Fixture /></AgentPreferencesProvider>
  </MotionConfig></I18nextProvider></React.StrictMode>))
  return {
    host, changes, state: () => state,
    trigger: () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!,
    update: async (model: string, effort: ComposerEffort) => { await act(async () => setState((current) => ({ ...current, modelReference: `${profile.id}:${model}`, effort }))) },
    visible: async (visible: boolean) => { await act(async () => setVisible(visible)) },
    close: async () => { await act(async () => root.unmount()); host.remove() },
  }
}

test("native model and effort update the displayed selector and survive an interaction remount", async () => {
  const view = await mount()
  try {
    assert.match(view.trigger().getAttribute("aria-label")!, /claude-sonnet-4-6/)
    await view.update("claude-opus-4-6[1m]", "high")
    assert.match(view.trigger().getAttribute("aria-label")!, /claude-opus-4-6\[1m\].*high/)
    assert.deepEqual(view.state(), { modelReference: `${profile.id}:claude-opus-4-6[1m]`, effort: "high", contextWindow: 200000 })
    await view.visible(false)
    await view.visible(true)
    assert.match(view.trigger().getAttribute("aria-label")!, /claude-opus-4-6\[1m\].*high/)
    assert.deepEqual(writes, [], "native synchronization must not change saved profile defaults")
  } finally { await view.close() }
})

test("a native selection received before profiles load is not overwritten by the default", async () => {
  const original = loadProfiles
  let finish!: (response: Response) => void
  const pending = new Promise<Response>((resolve) => { finish = resolve })
  loadProfiles = () => pending.then((response) => response.clone())
  const view = await mount()
  try {
    await view.update("custom:model", "low")
    await act(async () => { finish(await original()) })
    assert.match(view.trigger().getAttribute("aria-label")!, /custom:model.*low/)
    assert.deepEqual(view.state(), { modelReference: `${profile.id}:custom:model`, effort: "low", contextWindow: 200000 })
    assert.deepEqual(view.changes, [])
    assert.deepEqual(writes, [])
  } finally { loadProfiles = original; await view.close() }
})


test("context options stay available for any model and selecting 1M opens its warning below the option", async () => {
  const view = await mount()
  try {
    await view.update("custom:model", "medium")
    await act(async () => view.trigger().click())
    const trigger = document.querySelector<HTMLElement>('[role="menuitem"][aria-label="Context window 200K"]')
      ?? [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent?.includes("Context window"))!
    assert.ok(trigger)
    await act(async () => trigger.click())
    const option = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((el) => el.textContent === "1M")!
    assert.ok(option)
    await act(async () => option.click())
    assert.equal(view.state().contextWindow, 1000000)
    const warning = document.querySelector('[data-slot="tooltip-content"]')
    assert.match(warning?.textContent ?? "", /does not support a 1M context window/)
    assert.equal(warning?.getAttribute("data-side"), "bottom")
    const small = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((el) => el.textContent === "200K")!
    await act(async () => small.click())
    assert.equal(view.state().contextWindow, 200000)
    assert.equal(option.getAttribute("aria-checked"), "false")
    assert.equal(view.state().modelReference, `${profile.id}:custom:model`)
    assert.deepEqual(writes, [])
  } finally { await view.close() }
})

async function openEffortMenu(view: Awaited<ReturnType<typeof mount>>) {
  await act(async () => view.trigger().click())
  const trigger = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) => element.textContent?.startsWith("Effort"))
  assert.ok(trigger)
  await act(async () => trigger.click())
  return [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
}

test("Pi deepseek uses advertised levels before a session exists and clamps unsupported selections", async () => {
  const view = await mount({ isPi: true, model: "deepseek-flash" })
  try {
    assert.equal(view.state().effort, "high", "Pi clamps medium upward to supported high")
    const levels = await openEffortMenu(view)
    assert.deepEqual(levels.map((item) => item.textContent), ["Off", "low", "high", "max"])
    await act(async () => levels.find((item) => item.textContent === "max")!.click())
    assert.equal(view.state().effort, "max")
    await view.update("plain-model", "max")
    assert.equal(view.state().effort, "off", "switching to a non-reasoning model clears unsupported max")
    assert.deepEqual(writes, [])
  } finally { await view.close() }
})

test("Pi native effort levels override catalog metadata and off/max survive composer remounts", async () => {
  const view = await mount({ isPi: true, model: "deepseek-flash", effort: "off", effortLevels: ["off", "max"] })
  try {
    assert.match(view.trigger().getAttribute("aria-label")!, /Off/)
    assert.equal(view.state().effort, "off")
    const levels = await openEffortMenu(view)
    assert.deepEqual(levels.map((item) => item.textContent), ["Off", "max"])
    assert.equal(levels[0]?.getAttribute("aria-checked"), "true")
    await view.update("deepseek-flash", "max")
    await view.visible(false)
    await view.visible(true)
    assert.match(view.trigger().getAttribute("aria-label")!, /max/)
    assert.equal(view.state().effort, "max")
    await view.update("deepseek-flash", "off")
    assert.equal(view.state().effort, "off")
    assert.match(view.trigger().getAttribute("aria-label")!, /Off/)
    assert.deepEqual(writes, [], "TUI changes must not persist model defaults")
  } finally { await view.close() }
})
