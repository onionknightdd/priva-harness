import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

import type { StreamBlock } from "../../../src/features/agent-message/agent-message-data.ts"

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
  pretendToBeVisual: true,
})
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "DocumentFragment", "SVGElement", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key as keyof typeof dom.window],
  })
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
})
dom.window.matchMedia = (query) => ({
  matches: query.includes("prefers-reduced-motion"),
  media: query,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => true,
  onchange: null,
})
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) return { format: "module", source: "export default {}", shortCircuit: true }
    return nextLoad(url, context)
  },
})
after(() => {
  hooks.deregister()
  dom.window.close()
})

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { I18nextProvider, initReactI18next } = await import("react-i18next")
const i18n = (await import("i18next")).createInstance()
const { en } = await import("../../../src/i18n/locales/en.ts")
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } } })
const { GeneratedVisual } = await import("../../../src/features/agent-message/render-ui/generated-visual.tsx")

type ToolBlock = Extract<StreamBlock, { type: "tool_use" }>

const row = [
  'root = Stack([a, b], "row", "m")',
  'a = Text("Events", "small")',
  'b = Text("1280", "large")',
].join("\n")

function block(lang: string, status: "started" | "completed", ok?: boolean, output?: string): ToolBlock {
  return {
    type: "tool_use",
    id: "ui",
    blockId: "ui",
    index: 0,
    name: "static_visualize",
    input: { lang },
    tool: {
      id: "ui",
      name: "static_visualize",
      status,
      ...(ok === undefined ? {} : { ok }),
      ...(output === undefined ? {} : { output }),
      input: { lang },
    },
  }
}

async function mount(next: ToolBlock) {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  await act(async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <GeneratedVisual block={next} />
      </I18nextProvider>,
    )
  })
  return {
    host,
    async close() {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

test("renders a horizontal stack from a finished program", async () => {
  const view = await mount(block(row, "completed", true, row))
  try {
    const stack = view.host.querySelector("[data-slot='render-ui-stack']")
    assert.equal(stack?.getAttribute("data-direction"), "row")
    assert.match(stack?.className ?? "", /flex-row/)
    assert.equal(view.host.querySelectorAll("[data-slot='render-ui-text']").length, 2)
    assert.match(view.host.textContent ?? "", /Events/)
    assert.match(view.host.textContent ?? "", /1280/)
    assert.equal(view.host.querySelector("[role='alert']"), null)
  } finally {
    await view.close()
  }
})

test("keeps a partial program on screen and shows the validation error", async () => {
  const view = await mount(block(
    'root = Stack([title])\ntitle = Text("Hello")',
    "completed",
    false,
    "unknown-component: Widget",
  ))
  try {
    assert.match(view.host.textContent ?? "", /Hello/)
    assert.match(view.host.querySelector("[role='alert']")?.textContent ?? "", /unknown-component/)
  } finally {
    await view.close()
  }
})

test("does not throw while the lang string is still incomplete", async () => {
  const view = await mount(block('root = Stack([title])\ntitle = Text("Hel', "started"))
  try {
    assert.equal(view.host.querySelector("[data-slot='render-ui-stack']") instanceof dom.window.HTMLElement, true)
  } finally {
    await view.close()
  }
})
