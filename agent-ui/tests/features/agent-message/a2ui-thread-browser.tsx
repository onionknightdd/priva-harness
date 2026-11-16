import { StrictMode, useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import { MotionConfig } from "motion/react"

import { TooltipProvider } from "@/components/ui/tooltip"
import { AgentPreferencesProvider } from "@/features/settings/agent-preferences-context"
import { HarnessProvider } from "@/features/sidebar/header/harness-context"
import { ChatSessionProvider, useChatSessionActions, useChatThread } from "@/features/chat-session/chat-session-context"
import { AgentMessageThread } from "@/features/agent-message/components/agent-message-thread"
import { DashboardPluginSwitch } from "@/features/agent-message/components/dashboard-plugin-switch"
import { SessionViewProvider } from "@/features/agent-message/session-view-context"
import { UiActionProvider } from "@/features/agent-message/ui-action-context"
import { parseUiActionMessage } from "@/features/agent-message/ui-action"
import { assistantReplyMarkdown } from "@/features/agent-message/reply-download"
import type { AgentThreadMessage } from "@/features/agent-message/agent-message-data"
import i18n from "@/i18n"
import "@/index.css"
import salesResult from "../../fixtures/a2ui/sales-dashboard.json"
import tableResult from "../../fixtures/a2ui/root-table.json"
import formResult from "../../fixtures/a2ui/form-action.json"
import salesSource from "../../fixtures/a2ui/sales-dashboard.a2ui?raw"
import tableSource from "../../fixtures/a2ui/root-table.a2ui?raw"
import formSource from "../../fixtures/a2ui/form-action.a2ui?raw"

const query = new URLSearchParams(location.search)
document.documentElement.classList.toggle("dark", query.has("dark"))
const host = document.getElementById("fixture")!
if (query.has("narrow")) host.style.width = "390px"
await i18n.changeLanguage(query.has("zh") ? "zh-CN" : "en")
const createdAt = "2026-11-15T00:00:00Z"
type Scenario = "sales" | "table" | "form"
type Phase = "completed" | "pending" | "invalid" | "missing" | "duplicate"
const compilerError = "Unknown component: Invalid. Choose a component from the Agent dashboard catalog."
const scenarios = {
  sales: { result: salesResult, source: salesSource, request: "Show Q3 sales by region as a dashboard.", answer: "Q3 revenue reached $14.8M. North America contributed the largest share, and every region finished ahead of target." },
  table: { result: tableResult, source: tableSource, request: "Show the available example services as a table.", answer: "All three example services are ready. The table and this explanation stay within the same conversation column." },
  form: { result: formResult, source: formSource, request: "Let me update the regional report.", answer: "Edit the report title and region, then submit your changes." },
} as const
function answer(scenario: Scenario, phase: Phase) {
  const reference = `![${scenarios[scenario].request}](a2ui:${scenario})`
  const source = phase === "invalid" ? "root = Invalid()" : scenarios[scenario].source.trim()
  const block = `\`\`\`a2ui id=${scenario}\n${source}\n${phase === "pending" ? "" : "```"}`
  return `${reference}\n\n${phase === "missing" ? "" : block}${phase === "duplicate" ? `\n\n${reference}` : ""}${phase === "pending" ? "" : `\n\n${scenarios[scenario].answer}`}`
}
function reply(scenario: Scenario, phase: Phase): AgentThreadMessage {
  const content = answer(scenario, phase)
  return { id: "reply", role: "assistant", content, status: phase === "pending" ? "streaming" : "complete", createdAt,
    blocks: [
      { type: "tool_use", id: "skill", blockId: "skill", index: 0, name: "Skill", input: { skill: "agent-dashboard:agent-dashboard" }, tool: { id: "skill", name: "Skill", status: "completed", ok: true, output: "Agent dashboard skill loaded." } },
      { type: "text", blockId: "answer", index: 1, text: content },
    ] }
}
const transcript: AgentThreadMessage[] = [
  { id: "request", role: "user", content: scenarios.table.request, status: "complete", createdAt }, reply("table", "completed"),
]
const requests: string[] = []
const compileSources: string[] = []
const unexpected: string[] = []
window.fetch = async (input, init) => {
  const path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname
  requests.push(path)
  if (path === "/api/sandbox/a2ui/compile") {
    const source = JSON.parse(String(init?.body)).source as string
    compileSources.push(source)
    if (source === "root = Invalid()") return Response.json({ error: compilerError }, { status: 422 })
    const fixture = Object.values(scenarios).find((item) => item.source.trim() === source)
    if (fixture) return Response.json(fixture.result)
    unexpected.push(`unknown compile source: ${source}`)
    return Response.json({ error: "Unexpected source in isolated fixture" }, { status: 422 })
  }
  if (path === "/api/sandbox/agent/profile") return Response.json({ queue_behavior: "follow-up" })
  if (path === "/api/sandbox/credentials/profiles") return Response.json({ default_profile_id: null, profiles: [] })
  if (path === "/api/sandbox/agent/sessions/running") return Response.json({ running: [], warm: [] })
  if (path === "/api/sandbox/agent/sessions") return Response.json({ active_cwd: "/fixture", groups: [] })
  if (path === "/api/sandbox/agent/sessions/a2ui-fixture/thread") return Response.json({ run_mode: "agent", messages: transcript.map((message) => ({ ...message, created_at: message.createdAt })) })
  if (path.endsWith("/context-usage")) return Response.json(null)
  unexpected.push(path)
  throw new Error(`Unexpected fixture request: ${path}`)
}
const actions: NonNullable<ReturnType<typeof parseUiActionMessage>>[] = []
const onContinue = (message: string) => {
  const action = parseUiActionMessage(message)
  if (!action) throw new Error("Action lost its structured envelope")
  actions.push(action)
  document.getElementById("actions")!.textContent = JSON.stringify(actions, null, 2)
}
let changePhase = (_phase: Phase) => {}
let changeScenario = (_scenario: Scenario) => {}
export function FixtureThread() {
  const { openSession } = useChatSessionActions()
  const { threadMessages, messagesStatus } = useChatThread()
  const [phase, setPhase] = useState<Phase>("completed")
  const [scenario, setScenario] = useState<Scenario>(query.has("sales") ? "sales" : "table")
  const [enabled, setEnabled] = useState(false)
  const [pending, setPending] = useState(false)
  changePhase = setPhase
  changeScenario = (next) => { setScenario(next); setPhase("completed") }
  useEffect(() => {
    const frame = requestAnimationFrame(() => openSession({ sessionId: "a2ui-fixture", summary: "Isolated dashboard conversation", firstPrompt: null, customTitle: null, cwd: "/fixture", lastModified: 0, tag: null, tags: [], tagColors: {}, pinned: false, archived: false, runMode: "agent" }))
    return () => cancelAnimationFrame(frame)
  }, [openSession])
  const messages = useMemo(() => threadMessages.map((message) => message.id === "reply" ? reply(scenario, phase)
    : message.id === "request" ? { ...message, content: scenarios[scenario].request } : message), [threadMessages, phase, scenario])
  return <div className="@container/agent-message flex h-full min-h-0 flex-col bg-background text-foreground" data-fixture-ready={messagesStatus === "ready"} data-fixture-scenario={scenario}>
    <div className="flex items-center gap-3 border-b p-3 text-sm">
      <DashboardPluginSwitch active={enabled} pending={pending} onChange={(next) => { setPending(true); setTimeout(() => { setEnabled(next); setPending(false) }, 250) }} />
      <span>Agent dashboard · <span data-loaded-plugins>{JSON.stringify(enabled ? ["agent-dashboard"] : [])}</span></span>
    </div>
    <UiActionProvider onContinue={onContinue}><AgentMessageThread messages={messages} /></UiActionProvider>
  </div>
}
createRoot(host).render(<StrictMode><MotionConfig reducedMotion={query.has("reduced-motion") ? "always" : "user"}><TooltipProvider>
  <AgentPreferencesProvider><HarnessProvider><ChatSessionProvider><SessionViewProvider chatKey="a2ui-fixture" sessionId="a2ui-fixture">
    <FixtureThread />
  </SessionViewProvider></ChatSessionProvider></HarnessProvider></AgentPreferencesProvider>
</TooltipProvider></MotionConfig></StrictMode>)
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
async function until(condition: () => boolean, label: string) {
  const deadline = performance.now() + 6000
  while (!condition()) { if (performance.now() > deadline) throw new Error(label); await nextFrame() }
}
for (const scenario of ["table", "sales", "form"] as const) document.getElementById(scenario)!.addEventListener("click", () => changeScenario(scenario))
for (const phase of ["completed", "pending", "invalid", "missing", "duplicate"] as const) document.getElementById(phase)!.addEventListener("click", () => changePhase(phase))
document.getElementById("width")!.addEventListener("click", () => { host.style.width = host.clientWidth > 500 ? "390px" : "min(100%,1280px)" })
document.getElementById("theme")!.addEventListener("click", () => document.documentElement.classList.toggle("dark"))
async function runChecks() {
  const button = document.getElementById("run") as HTMLButtonElement
  const output = document.getElementById("results")!
  button.disabled = true
  const passed: string[] = []
  const check = (label: string, ok: boolean) => { if (!ok) throw new Error(label); passed.push(label) }
  Object.assign(window, { __a2uiThreadResult: { status: "running" } })
  try {
    changeScenario("table")
    await until(() => !!host.querySelector('[data-fixture-ready="true"]') && host.querySelectorAll(".a2ui-table-scroll tbody tr").length === 3, "The saved Markdown table failed to load")
    await document.fonts.ready
    await nextFrame()
    const viewport = host.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]')!
    const checkColumn = (scenario: Scenario) => {
      const text = Array.from(host.querySelectorAll<HTMLElement>("[data-reply] p")).find((node) => node.textContent === scenarios[scenario].answer)!
      const textColumn = text.closest<HTMLElement>("[data-reply]")!
      const visual = host.querySelector<HTMLElement>('[data-slot="dashboard-embed"]')!
      const textRect = textColumn.getBoundingClientRect(), visualRect = visual.getBoundingClientRect()
      check(`${scenario} answer stays within the reading column`, textRect.width <= 768)
      check(`${scenario} dashboard shares the answer column`, visualRect.width <= textRect.width + 1 && visualRect.left >= textRect.left - 1 && visualRect.right <= textRect.right + 1)
      check(`${scenario} dashboard does not overflow the conversation`, viewport.scrollWidth <= viewport.clientWidth + 1)
      return visual
    }
    check("uses the real session history loading path", requests.includes("/api/sandbox/agent/sessions/a2ui-fixture/thread"))
    check("no requests reach a live Runner or model", unexpected.length === 0)
    const table = checkColumn("table")
    const minimumCellWidth = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * 6
    const cells = Array.from(table.querySelectorAll<HTMLElement>("th, td"))
    check("table columns preserve readable Chinese statuses", cells.every((cell) => cell.getBoundingClientRect().width >= minimumCellWidth - 1))
    check("source fences are hidden from the rendered answer", host.querySelector('[data-reply] pre') === null)
    check("Markdown export retains the exact embed and source", assistantReplyMarkdown(reply("table", "completed")) === answer("table", "completed"))
    const toggle = host.querySelector<HTMLButtonElement>('[data-slot="dashboard-plugin-switch"] [role="switch"]')!
    const originalChecked = toggle.getAttribute("aria-checked")
    toggle.click()
    await nextFrame()
    check("plugin toggle waits for acknowledgement", toggle.disabled && toggle.getAttribute("aria-checked") === originalChecked)
    await until(() => !toggle.disabled && toggle.getAttribute("aria-checked") !== originalChecked, "Plugin toggle acknowledgement missing")
    check("plugin toggle acknowledgement preserves historical dashboard", table.isConnected)
    changeScenario("sales")
    await until(() => host.querySelectorAll(".a2ui-stat").length === 4, "The dashboard did not render")
    await nextFrame()
    const dashboard = checkColumn("sales")
    check("compiled metrics and bars survive history replay", host.querySelectorAll(".a2ui-stat").length === 4 && host.querySelectorAll(".recharts-bar-rectangle").length === 8)
    const priorActions = actions.length
    dashboard.querySelector<HTMLButtonElement>(".a2ui-action button")!.click()
    await until(() => actions.length === priorActions + 1, "Dashboard action was not delivered")
    const action = actions.at(-1)!.uiAction
    check("actions identify plugin, assistant message and embed", action.pluginId === "agent-dashboard" && action.messageId === "reply" && action.embedId === "sales" && action.action.surfaceId === "main" && !("toolCallId" in action))
    const priorCompiles = compileSources.length
    changePhase("pending")
    await until(() => !!host.querySelector('[data-slot="dashboard-embed"] [data-slot="skeleton"]'), "Incomplete Markdown did not show a skeleton")
    check("unfinished raw fence is never compiled", compileSources.length === priorCompiles && host.querySelectorAll(".a2ui-stat").length === 0)
    for (const phase of ["missing", "duplicate"] as const) {
      changePhase(phase)
      await until(() => !!host.querySelector('[data-slot="dashboard-embed"][role="alert"]'), `${phase} error is missing`)
      check(`${phase} IDs fail before the compiler`, compileSources.length === priorCompiles)
    }
    changePhase("invalid")
    await until(() => !!host.querySelector('[role="alert"]')?.textContent?.includes(compilerError), "Compiler error did not render")
    check("compiler errors never auto-send a repair request", actions.length === priorActions + 1)
    host.querySelector<HTMLButtonElement>('[data-slot="dashboard-embed"][role="alert"] button')!.click()
    await until(() => actions.length === priorActions + 2, "Explicit repair action missing")
    check("repair action keeps the failed embed origin", actions.at(-1)?.uiAction.embedId === "sales" && actions.at(-1)?.uiAction.action.name === "repair_dashboard")
    changeScenario("form")
    await until(() => !!host.querySelector('.a2ui-field input'), "Form did not render")
    const input = host.querySelector<HTMLInputElement>('.a2ui-field input')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Updated Q3 plan")
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await nextFrame()
    host.querySelector<HTMLButtonElement>(".a2ui-action button")!.click()
    await until(() => actions.length === priorActions + 3, "Form action missing")
    check("interactive field values reach the action envelope", actions.at(-1)?.uiAction.action.context.title === "Updated Q3 plan")
    changeScenario("sales")
    await until(() => host.querySelectorAll(".a2ui-stat").length === 4, "Historical dashboard did not replay")
    check("history replay never repeats actions", actions.length === priorActions + 3)
    Object.assign(window, { __a2uiThreadResult: { status: "passed", checks: passed, requests, actions } })
    output.textContent = `PASS ${passed.length} conversation checks\n${passed.join("\n")}`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    Object.assign(window, { __a2uiThreadResult: { status: "failed", error: message, checks: passed, requests } })
    output.textContent = `FAIL ${message}\n${passed.join("\n")}`
  } finally { button.disabled = false }
}
document.getElementById("run")!.addEventListener("click", () => void runChecks())
Object.assign(window, { __a2uiThreadResult: { status: "ready" }, runA2uiThreadChecks: runChecks })
