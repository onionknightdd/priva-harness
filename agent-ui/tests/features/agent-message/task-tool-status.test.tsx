import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

import type { AgentToolView } from "../../../src/features/agent-message/agent-tool-data"
import type { BackgroundTask } from "../../../src/features/agent-message/background-task-store"
import type { WorkflowCard } from "../../../src/features/agent-message/workflow-data"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "Element", "Node", "NodeFilter", "DocumentFragment", "ShadowRoot", "SVGElement", "Event", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "DOMRect", "MutationObserver", "getComputedStyle"]) {
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
const hooks = registerHooks({ load: (url, context, nextLoad) => {
  if (url.endsWith(".css")) return { format: "module", source: "export default {}", shortCircuit: true }
  return nextLoad(url, context)
} })
after(() => { hooks.deregister(); dom.window.close() })
const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { MotionConfig } = await import("motion/react")
const { I18nextProvider, initReactI18next } = await import("react-i18next")
const i18n = (await import("i18next")).createInstance()
const { en } = await import("../../../src/i18n/locales/en.ts")
const { zhCN } = await import("../../../src/i18n/locales/zh-CN.ts")
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en }, "zh-CN": { translation: zhCN } } })
const { AgentToolSummary } = await import("../../../src/features/agent-message/components/agent-tool-item.tsx")
const { WorkflowOverview } = await import("../../../src/features/agent-message/components/workflow-overview.tsx")
const { BackgroundTaskStatus } = await import("../../../src/features/agent-message/components/background-task-card.tsx")

test("Agent tool transitions remove successful indicators and retain accessible failure and open action", async () => {
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host)
  const agent: AgentToolView = { id: "agent", label: "Inspect changes", state: "running", blocks: [], inbox: [], notifications: [], toolCount: 3 }
  let opened = 0
  try {
    for (const language of ["en", "zh-CN"]) {
      await act(async () => i18n.changeLanguage(language))
      for (const state of ["running", "completed", "failed", "cancelled", "paused", "unknown"] as const) {
        await act(async () => root.render(<I18nextProvider i18n={i18n}><MotionConfig reducedMotion="always"><AgentToolSummary agent={{ ...agent, state }} onOpen={() => opened++} /></MotionConfig></I18nextProvider>))
        const quiet = state === "completed" || state === "failed"
        assert.equal(host.querySelectorAll('[data-slot="badge"]').length, quiet ? 0 : 1, state)
        const header = host.querySelector('[data-tool-status]')
        assert.equal(host.querySelectorAll('[data-slot="tool-error-indicator"]').length, state === "failed" ? 1 : 0)
        if (state === "failed") {
          assert.equal(header?.getAttribute("data-tool-status"), "error")
          assert.equal(header?.querySelector('[data-slot="tool-error-indicator"]')?.getAttribute("aria-label"), i18n.t("toolCard.failed"))
          assert.equal(header?.querySelector('svg.lucide-bot')?.closest('[data-tool-text]'), null, "the original tool icon must retain its own color")
          assert.equal(header?.querySelector('[data-tool-text]')?.textContent, agent.label)
        }
        if (state === "completed") assert.ok(!header?.textContent?.includes(i18n.t("agentMessage.workflowUI.status.completed")))
        const button = host.querySelector<HTMLButtonElement>("button")!
        assert.equal(button.closest('[data-tool-status="error"]'), null, "the open action must not inherit the failed title color")
        await act(async () => button.click())
      }
    }
    assert.equal(opened, 12)
  } finally { await act(async () => root.unmount()); host.remove() }
})

test("Workflow tool header settles quietly while expanded phase and agent status remain informative", async () => {
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host)
  const workflow: WorkflowCard = { workflowToolUseId: "workflow", name: "Review changes", summary: "Inspect the changes", status: "running", phases: [{ index: 1, title: "Review" }], agents: [{ index: 1, phaseIndex: 1, label: "Reviewer", state: "completed" }] }
  try {
    await act(async () => i18n.changeLanguage("en"))
    for (const status of ["running", "completed", "failed"] as const) {
      await act(async () => root.render(<I18nextProvider i18n={i18n}><MotionConfig reducedMotion="always"><WorkflowOverview workflow={{ ...workflow, status }} onOpenAgent={() => {}} /></MotionConfig></I18nextProvider>))
      const trigger = host.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')!
      assert.equal(trigger.getAttribute("aria-expanded"), "true", "settling a tool must not close the inspected workflow")
      if (status === "completed") assert.ok(!trigger.textContent?.includes(i18n.t("agentMessage.workflowUI.status.completed")))
      assert.equal(trigger.querySelectorAll('[data-slot="tool-error-indicator"]').length, status === "failed" ? 1 : 0)
      if (status === "failed") {
        const indicator = trigger.querySelector('[data-slot="tool-error-indicator"]')!
        assert.equal(indicator.getAttribute("aria-label"), i18n.t("toolCard.failed"))
        assert.ok(indicator.nextElementSibling?.matches('svg.lucide-chevron-down'), "the failed status must sit at the end of the tool header")
        assert.equal(trigger.querySelector('svg.lucide-workflow')?.closest('[data-tool-text]'), null)
        assert.equal(trigger.querySelectorAll('[data-tool-status="error"] [data-tool-text]').length, 3, "name, summary and metadata use the failure text color")
      }
      const phaseMark = host.querySelector('[role="img"][aria-label="Completed"]')
      assert.ok(phaseMark, "the workflow details must retain their phase progress")
      assert.equal(phaseMark.closest('[data-tool-status="error"]'), null, "a failed workflow header must not recolor successful child agents")
    }
  } finally { await act(async () => root.unmount()); host.remove() }
})

test("Background task completion removes its badge and stop action while failure keeps output usable", async () => {
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host)
  const task: BackgroundTask = { taskId: "task", kind: "bash", status: "running", description: "Run checks", summary: "Task output summary", outputFile: "/tmp/checks.log" }
  let stops = 0, outputs = 0
  try {
    await act(async () => i18n.changeLanguage("en"))
    for (const status of ["running", "completed", "failed", "paused", "cancelled", "unknown"] as const) {
      await act(async () => root.render(<I18nextProvider i18n={i18n}><MotionConfig reducedMotion="always"><BackgroundTaskStatus task={{ ...task, status }} onStop={() => stops++} onOpenOutput={() => outputs++} /></MotionConfig></I18nextProvider>))
      assert.equal(host.querySelectorAll('[data-slot="badge"]').length, status === "completed" || status === "failed" ? 0 : 1, status)
      const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")]
      const active = status === "running" || status === "paused"
      assert.equal(buttons.length, active ? 2 : 1)
      if (active) await act(async () => buttons[0]!.click())
      if (status === "failed") {
        assert.equal(host.querySelectorAll('[data-tool-status="error"][data-tool-text]').length, 2, "both description and output summary participate in failure styling")
        assert.equal(host.querySelector('[data-slot="tool-error-indicator"]')?.getAttribute("aria-label"), i18n.t("toolCard.failed"))
      }
      assert.equal(host.querySelectorAll('[data-slot="tool-error-indicator"]').length, status === "failed" ? 1 : 0)
      const output = buttons.at(-1)!
      assert.equal(output.closest('[data-tool-status="error"]'), null)
      await act(async () => output.click())
    }
    assert.equal(stops, 2)
    assert.equal(outputs, 6)
  } finally { await act(async () => root.unmount()); host.remove() }
})
