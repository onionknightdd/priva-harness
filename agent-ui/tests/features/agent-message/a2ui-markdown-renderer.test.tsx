import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Node", "Document", "DocumentFragment", "SVGElement", "MutationObserver", "getComputedStyle", "customElements", "CustomEvent", "Event", "ShadowRoot", "CSSStyleSheet"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
})
dom.window.matchMedia = (query) => ({ matches: query.includes("prefers-reduced-motion"), media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, onchange: null })
const hooks = registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith(".css")) return { format: "module", source: "export default {}", shortCircuit: true }
  if (url.endsWith(".svg")) return { format: "module", source: `export default ${JSON.stringify(url)}`, shortCircuit: true }
  const result = nextLoad(url, context)
  if (url.endsWith("/file-type-icon.tsx")) return { ...result, source: `import.meta.env = { DEV: false, BASE_URL: "/" };\n${result.source}` }
  return result
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
const { AssistantMarkdown } = await import("../../../src/features/agent-message/components/assistant-markdown.tsx")
const { UiActionProvider } = await import("../../../src/features/agent-message/ui-action-context.tsx")
const { parseUiActionMessage } = await import("../../../src/features/agent-message/ui-action.ts")
const form = JSON.parse(readFileSync(new URL("../../fixtures/a2ui/form-action.json", import.meta.url), "utf8"))
const source = readFileSync(new URL("../../fixtures/a2ui/form-action.a2ui", import.meta.url), "utf8").trim()
const markdown = (id = "report", body = source) => `![Regional report](a2ui:${id})\n\n\`\`\`a2ui id=${id}\n${body}\n\`\`\``
const requests: string[] = []
globalThis.fetch = async (input, init) => {
  assert.equal(input, "/api/sandbox/a2ui/compile")
  const requested = JSON.parse(String(init?.body)).source as string
  requests.push(requested)
  if (requested === "runtime failure") {
    const malformed = structuredClone(form)
    malformed.messages[0].createSurface.components.find((component: { id: string }) => component.id === "root").component = "Unregistered"
    return Response.json(malformed)
  }
  return requested.startsWith("invalid") ? Response.json({ error: "Unknown component: Invalid" }, { status: 422 }) : Response.json(form)
}
async function mount(text: string, streaming = false, onContinue?: (message: string) => void) {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const render = async (next: string, nextStreaming = streaming, messageId = "reply-stable") => {
    await act(async () => root.render(<I18nextProvider i18n={i18n}><UiActionProvider onContinue={onContinue}>
      <AssistantMarkdown messageId={messageId} mode={nextStreaming ? "streaming" : "static"} isAnimating={nextStreaming}>{next}</AssistantMarkdown>
    </UiActionProvider></I18nextProvider>))
  }
  await render(text)
  return { host, render, async close() { await act(async () => root.unmount()); host.remove() } }
}

test("raw incomplete fences stay pending without compiling repaired Markdown", async () => {
  const before = requests.length
  const complete = markdown()
  const view = await mount(complete.slice(0, -3), true)
  try {
    assert.ok(view.host.querySelector('[role="status"] [data-slot="skeleton"]'))
    assert.equal(requests.length, before)
    assert.equal(view.host.querySelector("input, pre, img"), null)
    await view.render(complete, true)
    assert.equal(view.host.querySelector<HTMLInputElement>("input")?.value, "Q3 plan")
    assert.equal(requests.length, before + 1)
    assert.equal(view.host.querySelector("pre, img, p [data-slot='dashboard-embed']"), null)
  } finally { await view.close() }
})

test("appending prose and native transcript identity preserves form state and action origin", async () => {
  const actions: string[] = []
  const view = await mount(markdown(), true, (action) => { actions.push(action) })
  try {
    const input = view.host.querySelector<HTMLInputElement>("input")!
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, "Updated report")
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
    })
    await view.render(`${markdown()}\n\nAdditional explanation.`, true, "native-reply")
    assert.equal(view.host.querySelector("input"), input)
    assert.equal(input.value, "Updated report")
    assert.equal(actions.length, 0)
    await act(async () => view.host.querySelector<HTMLButtonElement>(".a2ui-action button")!.click())
    const envelope = parseUiActionMessage(actions[0])!.uiAction
    assert.equal(envelope.pluginId, "agent-dashboard")
    assert.equal(envelope.messageId, "native-reply")
    assert.equal(envelope.embedId, "report")
    assert.equal(envelope.action.context.title, "Updated report")
    assert.equal("toolCallId" in envelope, false)
    await view.render(markdown(), false)
    assert.equal(actions.length, 1)
  } finally { await view.close() }
})

test("missing or duplicate IDs display explicit errors without compiler requests", async () => {
  for (const text of ["![Missing](a2ui:missing)", `${markdown()}\n\n![Again](a2ui:report)`]) {
    const before = requests.length
    const view = await mount(text)
    try {
      assert.ok(view.host.querySelector('[role="alert"]'))
      assert.equal(requests.length, before)
      assert.equal(view.host.querySelector("button"), null, "read-only history must not offer a repair action")
    } finally { await view.close() }
  }
})

test("compiler error offers an explicit repair action and never auto-sends", async () => {
  const actions: string[] = []
  const view = await mount(markdown("broken", "invalid component"), false, (action) => { actions.push(action) })
  try {
    assert.match(view.host.querySelector('[role="alert"]')?.textContent ?? "", /Unknown component: Invalid/)
    assert.equal(actions.length, 0)
    await act(async () => view.host.querySelector<HTMLButtonElement>('button')!.click())
    const envelope = parseUiActionMessage(actions[0])!.uiAction
    assert.equal(envelope.embedId, "broken")
    assert.equal(envelope.action.name, "repair_dashboard")
    assert.equal(envelope.action.context.error, "Unknown component: Invalid")
  } finally { await view.close() }
})

test("raw HTML cannot render a second dashboard using a valid Markdown ID", async () => {
  const view = await mount(`${markdown()}\n\n<agent-dashboard embed="report" label="Raw">raw content</agent-dashboard>`)
  try {
    assert.equal(view.host.querySelectorAll('[data-slot="dashboard-embed"]').length, 1)
    assert.ok(view.host.textContent?.includes("raw content"))
  } finally { await view.close() }
})

test("renderer validation errors retain the explicit repair action", async () => {
  const view = await mount(markdown("runtime-error", "runtime failure"), false, () => {})
  try {
    assert.ok(view.host.querySelector('[data-slot="dashboard-embed"][role="alert"] button'))
    assert.equal(view.host.querySelector('[data-slot="a2ui-visual"]'), null)
  } finally { await view.close() }
})
