import { StrictMode, useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import { MotionConfig } from "motion/react"

import { TooltipProvider } from "@/components/ui/tooltip"
import { AgentPreferencesProvider } from "@/features/settings/agent-preferences-context"
import { HarnessProvider } from "@/features/sidebar/header/harness-context"
import { ChatSessionProvider, useChatSessionActions, useChatThread } from "@/features/chat-session/chat-session-context"
import { AgentMessageThread } from "@/features/agent-message/components/agent-message-thread"
import { SessionViewProvider } from "@/features/agent-message/session-view-context"
import { UiActionProvider } from "@/features/agent-message/ui-action-context"
import { parseUiActionMessage } from "@/features/agent-message/ui-action"
import type { AgentThreadMessage, StreamBlock } from "@/features/agent-message/agent-message-data"
import i18n from "@/i18n"
import "@/index.css"
import salesResult from "../../fixtures/a2ui/sales-dashboard.json"
import tableResult from "../../fixtures/a2ui/root-table.json"

const query = new URLSearchParams(location.search)
document.documentElement.classList.toggle("dark", query.has("dark"))
const host = document.getElementById("fixture")!
if (query.has("narrow")) host.style.width = "390px"
await i18n.changeLanguage(query.has("zh") ? "zh-CN" : "en")
const createdAt = "2026-11-15T00:00:00Z"
type Scenario = "sales" | "retry"
type Phase = "completed" | "pending" | "failed" | "malformed"
const originalError = "A2UI source is invalid: Create exactly one UI with root = Component(...). Use the default main surface; do not target another surface."
const scenarios = {
  sales: {
    result: salesResult, toolId: "sales-ui", request: "Show Q3 sales by region as a dashboard.",
    answer: "Q3 revenue reached $14.8M. North America contributed the largest share, and every region finished ahead of target. The dashboard and this explanation share the conversation's reading width.",
  },
  retry: {
    result: tableResult, toolId: "table-ui", request: "Show the available example services as a table.",
    answer: "All three example services are ready. The table and this explanation stay within the same conversation column.",
  },
} as const
const failedAttempt: Extract<StreamBlock, { type: "tool_use" }> = {
  type: "tool_use", id: "failed-ui", blockId: "failed-ui", index: 0, name: "mcp__agentWorkshop__render_ui",
  input: { source: 'surface("mcp_status")' },
  tool: { id: "failed-ui", name: "mcp__agentWorkshop__render_ui", status: "completed", ok: false, output: originalError },
}
function answerBlocks(scenario: Scenario, phase: Phase): StreamBlock[] {
  const spec = scenarios[scenario]
  return [
    ...(scenario === "retry" ? [failedAttempt] : [{ type: "thinking" as const, blockId: "thought", index: 0, text: "Comparing the regional sales results with quarterly targets." }]),
    { type: "tool_use", id: spec.toolId, blockId: spec.toolId, index: 1, name: "render_ui", input: { source: "compiler fixture" },
      tool: { id: spec.toolId, name: "render_ui", status: phase === "pending" ? "running" : "completed", ok: phase === "completed" || phase === "malformed",
        output: phase === "completed" ? JSON.stringify(spec.result) : phase === "malformed" ? "not JSON" : phase === "failed" ? originalError : undefined } },
    { type: "text", blockId: "answer", index: 2, text: spec.answer },
  ]
}
const transcript: AgentThreadMessage[] = [
  { id: "request", role: "user", content: scenarios.retry.request, status: "complete", createdAt },
  { id: "reply", role: "assistant", content: scenarios.retry.answer, status: "complete", createdAt, blocks: answerBlocks("retry", "completed") },
]
const requests: string[] = []
const unexpected: string[] = []
window.fetch = async (input) => {
  const path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname
  requests.push(path)
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
  const [scenario, setScenario] = useState<Scenario>(query.has("sales") ? "sales" : "retry")
  changePhase = setPhase
  changeScenario = (next) => { setScenario(next); setPhase("completed") }
  useEffect(() => {
    const frame = requestAnimationFrame(() => openSession({ sessionId: "a2ui-fixture", summary: "Isolated A2UI conversation", firstPrompt: null, customTitle: null, cwd: "/fixture", lastModified: 0, tag: null, tags: [], tagColors: {}, pinned: false, archived: false, runMode: "agent" }))
    return () => cancelAnimationFrame(frame)
  }, [openSession])
  const messages = useMemo(() => threadMessages.map((message) => message.id === "reply" ? {
    ...message, content: scenarios[scenario].answer, blocks: answerBlocks(scenario, phase),
  } : message.id === "request" ? { ...message, content: scenarios[scenario].request } : message), [threadMessages, phase, scenario])
  return <div className="@container/agent-message h-full min-h-0 bg-background text-foreground" data-fixture-ready={messagesStatus === "ready"} data-fixture-scenario={scenario}>
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
document.getElementById("sales")!.addEventListener("click", () => changeScenario("sales"))
document.getElementById("retry")!.addEventListener("click", () => changeScenario("retry"))
document.getElementById("pending")!.addEventListener("click", () => changePhase("pending"))
document.getElementById("failed")!.addEventListener("click", () => changePhase("failed"))
document.getElementById("complete")!.addEventListener("click", () => changePhase("completed"))
document.getElementById("width")!.addEventListener("click", () => { host.style.width = host.clientWidth > 500 ? "390px" : "min(100%,1280px)" })
document.getElementById("theme")!.addEventListener("click", () => document.documentElement.classList.toggle("dark"))
document.getElementById("run")!.addEventListener("click", async (event) => {
  const button = event.currentTarget as HTMLButtonElement
  const output = document.getElementById("results")!
  button.disabled = true
  const passed: string[] = []
  const check = (label: string, ok: boolean) => { if (!ok) throw new Error(label); passed.push(label) }
  try {
    changeScenario("retry")
    await until(() => !!host.querySelector('[data-fixture-ready="true"]') && host.querySelectorAll(".a2ui-table-scroll tbody tr").length === 3, "The real conversation failed to load its successful root Table")
    await document.fonts.ready
    await nextFrame()
    const viewport = host.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]')!
    const checkColumn = (scenario: Scenario) => {
      const text = Array.from(host.querySelectorAll<HTMLElement>("[data-reply] p")).find((node) => node.textContent === scenarios[scenario].answer)!
      const textColumn = text.closest<HTMLElement>("[data-reply]")!
      const visualElement = host.querySelector<HTMLElement>('[data-slot="generated-visual"]')!
      const textRect = textColumn.getBoundingClientRect()
      const visualRect = visualElement.getBoundingClientRect()
      check(`${scenario} answer stays within the reading column`, textRect.width <= 768)
      check(`${scenario} visual stays within the same column as the answer`, visualRect.width <= textRect.width + 1 && visualRect.left >= textRect.left - 1 && visualRect.right <= textRect.right + 1)
      check(`${scenario} visual does not cause horizontal scrolling`, viewport.scrollWidth <= viewport.clientWidth + 1)
      return visualElement
    }
    check("uses the real session history loading path", requests.includes("/api/sandbox/agent/sessions/a2ui-fixture/thread"))
    check("no requests reach a live Runner", unexpected.length === 0)
    const table = checkColumn("retry")
    const minimumCellWidth = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * 6
    const cells = Array.from(table.querySelectorAll<HTMLElement>("th, td"))
    check("the root Table includes long descriptions and short Chinese statuses", table.querySelectorAll("thead th").length === 4 && table.textContent?.includes("已就绪") === true && table.textContent?.includes("documentation library") === true)
    check("table cells preserve at least 6rem for readable status text", cells.length > 0 && cells.every((cell) => cell.getBoundingClientRect().width >= minimumCellWidth - 1))
    check("a failed attempt leaves only the successful inline Table", host.querySelectorAll('[data-slot="generated-visual"]').length === 1 && table.querySelectorAll("tbody tr").length === 3)
    check("the final answer has no failed-attempt banner", host.querySelector('[data-reply] [role="alert"]') === null)
    const process = host.querySelector<HTMLElement>("[class~='group/process']")!
    const processTrigger = process.querySelector<HTMLButtonElement>("button[aria-expanded]")!
    if (processTrigger.getAttribute("aria-expanded") !== "true") processTrigger.click()
    await until(() => !!process.querySelector('[data-tool-status="error"]'), "The failed attempt disappeared from process history")
    const failureTrigger = process.querySelector<HTMLButtonElement>('[data-tool-status="error"]')!
    if (failureTrigger.getAttribute("aria-expanded") !== "true") failureTrigger.click()
    await until(() => Array.from(process.querySelectorAll<HTMLElement>('pre[role="alert"]')).some((node) => node.textContent === originalError && !node.closest('[aria-hidden="true"]')), "The original error was not available in expanded process details")
    check("expanding the failed attempt preserves its original error", process.textContent?.includes(originalError) === true)
    check("expanding details keeps the successful UI and final answer intact", table.isConnected && host.querySelector('[data-reply] [role="alert"]') === null)
    processTrigger.click()
    changeScenario("sales")
    await until(() => host.querySelectorAll(".a2ui-stat").length === 4, "The dashboard scenario did not render")
    await nextFrame()
    const dashboard = checkColumn("sales")
    check("all four metrics and bars survive history replay", host.querySelectorAll(".a2ui-stat").length === 4 && host.querySelectorAll(".recharts-bar-rectangle").length === 8)
    const priorActions = actions.length
    dashboard.querySelector<HTMLButtonElement>(".a2ui-action button")!.click()
    await until(() => actions.length === priorActions + 1, "Dashboard action was not delivered")
    const action = actions.at(-1)!
    check("structured action retains the originating tool and surface", action.uiAction.toolCallId === "sales-ui" && action.uiAction.action.surfaceId === "main" && Object.keys(action.uiAction.action.context).length > 0)
    changePhase("pending")
    await until(() => !!host.querySelector('[data-slot="generated-visual"] [data-slot="skeleton"]'), "Pending tool did not show its loading state")
    check("unfinished source is never rendered", host.querySelectorAll(".a2ui-stat").length === 0)
    changePhase("failed")
    await until(() => host.querySelector('[data-slot="generated-visual"]') === null, "A failed tool left a standalone answer banner")
    check("completed failure is process history rather than an answer banner", host.querySelector('[data-reply] [role="alert"]') === null)
    changePhase("malformed")
    await until(() => !!host.querySelector('[data-slot="generated-visual"][role="alert"]'), "Malformed successful output lost its readable inline error")
    passed.push("malformed successful output retains a readable UI error")
    changePhase("completed")
    await until(() => host.querySelectorAll(".a2ui-stat").length === 4, "Completed canonical result did not recover")
    check("replaying saved messages never repeats an action", actions.length === priorActions + 1)
    changeScenario("retry")
    await until(() => host.querySelectorAll(".a2ui-table-scroll tbody tr").length === 3, "Successful Table did not replay")
    output.textContent = `PASS ${passed.length} conversation checks\n${passed.join("\n")}`
  } catch (error) { output.textContent = `FAIL ${error instanceof Error ? error.message : error}\n${passed.join("\n")}` }
  finally { button.disabled = false }
})
