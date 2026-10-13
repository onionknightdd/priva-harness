import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"
import type { ProfileDraft } from "../../../src/features/model-settings/model-settings.types.ts"
import type { ModelProfileSummary } from "../../../src/features/model-settings/model-profile-api.ts"

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
const hooks = registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith(".css")) return { format: "module", source: "export default {}", shortCircuit: true }
  if (url.endsWith(".svg")) return { format: "module", source: `export default ${JSON.stringify(url)}`, shortCircuit: true }
  return nextLoad(url, context)
} })
const originalFetch = globalThis.fetch
after(() => { hooks.deregister(); dom.window.close(); globalThis.fetch = originalFetch })
const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { I18nextProvider, initReactI18next } = await import("react-i18next")
const i18n = (await import("i18next")).createInstance()
const { en } = await import("../../../src/i18n/locales/en.ts")
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } } })
const { ClassifierModelFields } = await import("../../../src/features/model-settings/classifier-model-fields.tsx")
const catalog = { imageUnderstanding: [], imageGeneration: [], imageEdit: [], classification: [] }
const profile: ModelProfileSummary = { id: "chat", label: "Chat", baseUrl: "https://chat.test/v1", authTokenSet: true, modelCount: 1,
  defaultModel: "chat-model", imageUnderstandingModel: null, imageGenerationModel: null, imageEditModel: null,
  classifierApi: null, classifierModel: null, classifierProfileId: null, modelCapabilities: catalog }
const alternate = { ...profile, id: "classifier", label: "Classify connection", baseUrl: "https://classify.test" }

async function mount(initial: Partial<ProfileDraft> = {}) {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  let current: ProfileDraft = { ...profile, authToken: "", ...initial }
  function Harness() {
    const [draft, setDraft] = React.useState(current)
    current = draft
    return <I18nextProvider i18n={i18n}><ClassifierModelFields draft={draft} profile={profile} profiles={[profile, alternate]} disabled={false}
      onDraftChange={(key, value) => setDraft((before) => ({ ...before, [key]: value }))}
      onCatalogChange={(modelCapabilities) => setDraft((before) => ({ ...before, modelCapabilities }))} /></I18nextProvider>
  }
  await act(async () => root.render(<Harness />))
  const input = () => {
    const element = host.querySelector<HTMLInputElement>("#classifier-model")
    assert.ok(element)
    return element
  }
  const type = async (value: string) => { await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set?.call(input(), value)
    input().dispatchEvent(new dom.window.Event("input", { bubbles: true }))
  }) }
  const choose = async (label: string, text: string) => {
    const trigger = host.querySelector<HTMLButtonElement>(`[aria-labelledby="${label}"]`)
    assert.ok(trigger)
    await act(async () => trigger.click())
    const item = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((element) => element.textContent === text)
    assert.ok(item, `Missing option ${text}`)
    await act(async () => item.click())
  }
  const runTest = async () => {
    const button = [...host.querySelectorAll("button")].find((element) => element.textContent === "Test")
    assert.ok(button)
    await act(async () => button.click())
  }
  return { host, input, type, choose, runTest, draft: () => current, close: async () => { await act(async () => root.unmount()); host.remove() } }
}

test("selects protocol and saved connection, accepts a custom model ID and tests that exact binding", async () => {
  const requests: { url: string; body: unknown }[] = []
  globalThis.fetch = (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(String(options?.body)) })
    return Promise.resolve(Response.json({ model_id: "custom-classifier", capability: "classification", supported: true }))
  }
  const view = await mount()
  try {
    assert.equal(view.input().disabled, true)
    await view.choose("classifier-protocol-label", "typesafe-system-one")
    await view.choose("classifier-connection-label", "Classify connection")
    await view.type("custom-classifier")
    assert.equal(view.draft().classifierModel, "custom-classifier")
    await view.runTest()
    assert.equal(requests[0]?.url, "/api/sandbox/credentials/profiles/chat/capabilities/probe")
    assert.deepEqual(requests[0]?.body, { base_url: profile.baseUrl, classifier_api: "typesafe-system-one", classifier_profile_id: "classifier", model_id: "custom-classifier", capability: "classification" })
    assert.deepEqual(view.draft().modelCapabilities.classification, ["custom-classifier"])
    assert.match(view.host.textContent ?? "", /Supported/)
    await view.choose("classifier-protocol-label", "Disabled")
    assert.equal(view.draft().classifierModel, null)
    assert.equal(view.draft().classifierProfileId, null)
  } finally { await view.close() }
})

test("discards a stale probe and keeps the entered model available after a failed test", async () => {
  let finish: ((response: Response) => void) | undefined
  let signal: AbortSignal | null | undefined
  globalThis.fetch = (_url, options) => { signal = options?.signal; return new Promise((resolve) => { finish = resolve }) }
  const view = await mount({ classifierApi: "openai-decisions", classifierModel: "old-model" })
  try {
    await view.runTest()
    await view.type("new-model")
    assert.equal(signal?.aborted, true)
    await act(async () => finish?.(Response.json({ model_id: "old-model", supported: true, capability: "classification" })))
    assert.deepEqual(view.draft().modelCapabilities.classification, [])
    globalThis.fetch = () => Promise.resolve(Response.json({ detail: "Classifier endpoint unavailable" }, { status: 502 }))
    await view.runTest()
    assert.equal(view.draft().classifierModel, "new-model")
    assert.match(view.host.textContent ?? "", /Probe failed/)
  } finally { await view.close() }
})
