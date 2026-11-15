import { StrictMode, useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import { MotionConfig } from "motion/react"
import { TooltipProvider } from "../../../src/components/ui/tooltip"
import { AgentPreferencesProvider } from "../../../src/features/settings/agent-preferences-context"
import { HarnessProvider } from "../../../src/features/sidebar/header/harness-context"
import { ChatSessionProvider, useChatSessionActions, useChatThread } from "../../../src/features/chat-session/chat-session-context"
import { AgentMessageThread } from "../../../src/features/agent-message/components/agent-message-thread"
import { SessionViewProvider } from "../../../src/features/agent-message/session-view-context"
import type { AgentThreadMessage } from "../../../src/features/agent-message/agent-message-data"
import { AGENT_CHAT_HEADER_HEIGHT } from "../../../src/features/agent-message/agent-chat-layout"
import i18n from "../../../src/i18n"
import "../../../src/index.css"

const query = new URLSearchParams(location.search)
const reduced = query.has("reduced-motion")
document.documentElement.classList.toggle("dark", query.has("dark"))
const host = document.querySelector<HTMLElement>("#fixture")!
if (query.has("narrow")) host.style.width = "390px"
if (reduced) {
  const matchMedia = window.matchMedia.bind(window)
  window.matchMedia = media => media.includes("prefers-reduced-motion")
    ? Object.assign(new EventTarget(), { matches: true, media, onchange: null, addListener() {}, removeListener() {} }) as MediaQueryList
    : matchMedia(media)
}
await i18n.changeLanguage(query.has("zh") ? "zh-CN" : "en")

const createdAt = "2026-11-15T00:00:00Z"
const latestText = "Latest reply remains readable after the long compaction summary."
const streamingTail = "Newest streaming continuation remains readable below its working status."
const summary = Array.from({ length: 110 }, (_, index) => `Summary line ${index + 1}: preserve the completed task, the accepted decision, and the next action.`).join("\n\n")
const messages: AgentThreadMessage[] = [
  { id: "ordinary-user", role: "user", content: "Ordinary user bubble must keep its sticky behavior.", status: "complete", createdAt },
  { id: "ordinary-reply", role: "assistant", content: Array.from({ length: 28 }, (_, index) => `Earlier response paragraph ${index + 1}. This provides enough space to scroll within an ordinary user turn.`).join("\n\n"), status: "complete", createdAt },
  { id: "compact-marker", role: "user", content: "/compact", compact: { phase: "compacted", summary }, status: "complete", createdAt },
  { id: "latest-reply", role: "assistant", content: latestText, status: "complete", createdAt },
]
const requests: string[] = [], unexpected: string[] = []
// This isolated origin never forwards an API call to a real Runner/session.
window.fetch = async input => {
  const path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname
  requests.push(path)
  if (path === "/api/sandbox/agent/profile") return Response.json({ queue_behavior: "follow-up" })
  if (path === "/api/sandbox/credentials/profiles") return Response.json({ default_profile_id: null, profiles: [] })
  if (path === "/api/sandbox/agent/sessions/running") return Response.json({ running: [], warm: [] })
  if (path === "/api/sandbox/agent/sessions") return Response.json({ active_cwd: "/fixture", groups: [] })
  if (path === "/api/sandbox/agent/sessions/compact-fixture/thread") return Response.json({ run_mode: "agent", messages: messages.map(message => ({ ...message, created_at: message.createdAt })) })
  if (path.endsWith("/context-usage")) return Response.json(null)
  unexpected.push(path)
  throw new Error(`Unexpected fixture request: ${path}`)
}

let changeStreaming = (_streaming: boolean) => {}
let growStreamingReply = () => {}
export function FixtureThread() {
  const { openSession } = useChatSessionActions()
  const { threadMessages, messagesStatus } = useChatThread()
  const [streaming, setStreaming] = useState(false)
  const [longStreaming, setLongStreaming] = useState(false)
  changeStreaming = value => { setStreaming(value); if (!value) setLongStreaming(false) }
  growStreamingReply = () => setLongStreaming(true)
  useEffect(() => {
    const frame = requestAnimationFrame(() => openSession({ sessionId: "compact-fixture", summary: "Isolated compaction regression", firstPrompt: null, customTitle: null, cwd: "/fixture", lastModified: 0, tag: null, tags: [], tagColors: {}, pinned: false, archived: false, runMode: "agent" }))
    return () => cancelAnimationFrame(frame)
  }, [openSession])
  const visible = useMemo(() => threadMessages.map(message => message.id === "latest-reply" && streaming ? {
    ...message, status: "streaming" as const,
    content: longStreaming ? `${message.content}\n\n${Array.from({ length: 20 }, (_, index) => `Live response paragraph ${index + 1}: the response continues beyond one viewport so its working line reaches the sticky threshold.`).join("\n\n")}\n\n${streamingTail}` : message.content,
  } : message), [threadMessages, streaming, longStreaming])
  return <div className="@container/agent-message h-full min-h-0 bg-background text-foreground" data-fixture-ready={messagesStatus === "ready"}>
    <AgentMessageThread messages={visible} />
  </div>
}
createRoot(host).render(<StrictMode><MotionConfig reducedMotion={reduced ? "always" : "never"}><TooltipProvider>
  <AgentPreferencesProvider><HarnessProvider><ChatSessionProvider><SessionViewProvider chatKey="compact-fixture" sessionId="compact-fixture">
    <FixtureThread />
  </SessionViewProvider></ChatSessionProvider></HarnessProvider></AgentPreferencesProvider>
</TooltipProvider></MotionConfig></StrictMode>)

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
async function waitForDOM(condition: () => boolean, message: string, timeout = 5000) {
  const deadline = performance.now() + timeout
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(message)
    await nextFrame()
  }
}
const viewport = () => host.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]')!
const compact = () => host.querySelector<HTMLElement>('[data-compact-phase="compacted"]')!
const latest = () => [...host.querySelectorAll<HTMLElement>('[data-reply-scope] p')].find(element => element.textContent === latestText)!
async function settleLayout() {
  let previous = -1, stable = 0
  await waitForDOM(() => {
    const height = viewport().scrollHeight
    stable = Math.abs(previous - height) < 1 ? stable + 1 : 0
    previous = height
    return stable >= 8
  }, "Thread layout did not settle after expanding the summary")
}
async function scrollToEnd() {
  viewport().dispatchEvent(new WheelEvent("wheel", { deltaY: 1, bubbles: true }))
  viewport().scrollTop = viewport().scrollHeight
  await nextFrame()
  viewport().scrollTop = viewport().scrollHeight
  await nextFrame()
}
document.querySelector("#streaming")!.addEventListener("click", () => changeStreaming(true))
document.querySelector("#complete")!.addEventListener("click", () => changeStreaming(false))
document.querySelector<HTMLButtonElement>("#run")!.addEventListener("click", async event => {
  const button = event.currentTarget as HTMLButtonElement
  const output = document.querySelector("#results")!
  button.disabled = true
  output.textContent = "Running compact thread checks…"
  let count = 0
  const failures: string[] = []
  const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); count++ }
  const runCase = async (name: string, body: () => Promise<void>) => {
    try { await body() } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : error}`) }
  }
  try {
    await waitForDOM(() => !!host.querySelector('[data-fixture-ready="true"]') && !!compact() && !!latest(), "The real AgentMessageThread did not load the mocked session transcript")
    changeStreaming(false)
    await nextFrame()
    const trigger = compact().querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')!
    if (trigger.getAttribute("aria-expanded") !== "true") trigger.click()
    await waitForDOM(() => compact().textContent?.includes("Summary line 110") === true && compact().getBoundingClientRect().height > viewport().clientHeight * 3, "The complete long compaction summary did not expand")
    await settleLayout()
    check(requests.includes("/api/sandbox/agent/sessions/compact-fixture/thread"), "Fixture bypassed the real session loading path")
    check(unexpected.length === 0, `Unexpected API calls: ${unexpected.join(", ")}`)
    await runCase("Expanded summary", async () => {
      await scrollToEnd()
      const reply = latest(), rect = reply.getBoundingClientRect(), scrollRect = viewport().getBoundingClientRect()
      check(rect.top >= scrollRect.top + AGENT_CHAT_HEADER_HEIGHT && rect.bottom <= scrollRect.bottom, "Latest reply is outside the visible viewport at the end")
      const top = document.elementFromPoint(rect.left + Math.min(80, rect.width / 2), rect.top + rect.height / 2)
      check(!!top && reply.contains(top), `Expanded compaction summary covers the latest reply (${top?.closest('[data-compact-phase]') ? "summary hit" : top?.tagName ?? "no hit"})`)
      check(!compact().closest('[data-slot="sticky-freeze"]'), "Compaction summary is still inside a sticky user bar")
    })
    await runCase("Collapse and reopen", async () => {
      const expandedHeight = viewport().scrollHeight
      trigger.click()
      await waitForDOM(() => trigger.getAttribute("aria-expanded") === "false" && !compact().textContent?.includes("Summary line 110"), "Collapsed summary did not release its content")
      await settleLayout()
      check(viewport().scrollHeight < expandedHeight - viewport().clientHeight * 3, "Collapsing the summary did not restore the normal document height")
      await scrollToEnd()
      const reply = latest(), rect = reply.getBoundingClientRect(), top = document.elementFromPoint(rect.left + Math.min(80, rect.width / 2), rect.top + rect.height / 2)
      check(!!top && reply.contains(top), "Collapsing the summary hides the latest reply")
      trigger.click()
      await waitForDOM(() => trigger.getAttribute("aria-expanded") === "true" && compact().textContent?.includes("Summary line 110") === true && compact().getBoundingClientRect().height > viewport().clientHeight * 3, "Reopened summary did not restore its complete content")
      await settleLayout()
      await scrollToEnd()
      const reopenedRect = latest().getBoundingClientRect(), reopenedHit = document.elementFromPoint(reopenedRect.left + Math.min(80, reopenedRect.width / 2), reopenedRect.top + reopenedRect.height / 2)
      check(!!reopenedHit && latest().contains(reopenedHit), "Reopening the summary covers the latest reply again")
    })
    await runCase("Streaming status", async () => {
      changeStreaming(true)
      await waitForDOM(() => !!host.querySelector('[data-slot="working-status-line"]'), "Streaming reply did not render the real working status line")
      await settleLayout()
      await scrollToEnd()
      const working = host.querySelector<HTMLElement>('[data-slot="working-status-line"]')!
      const bar = working.closest<HTMLElement>('[data-slot="sticky-freeze"]')!
      check(Number.parseFloat(getComputedStyle(bar).top) === AGENT_CHAT_HEADER_HEIGHT, "Working status adds the expanded summary height to its sticky offset")
      const rect = latest().getBoundingClientRect(), top = document.elementFromPoint(rect.left + Math.min(80, rect.width / 2), rect.top + rect.height / 2)
      check(!!top && latest().contains(top), "Expanded summary covers the streaming reply")
      growStreamingReply()
      await waitForDOM(() => [...host.querySelectorAll('[data-reply-scope] p')].some(element => element.textContent === streamingTail), "Streaming continuation did not render")
      await settleLayout()
      await scrollToEnd()
      check(Math.abs(bar.getBoundingClientRect().top - viewport().getBoundingClientRect().top - AGENT_CHAT_HEADER_HEIGHT) <= 1, "Working status does not pin below the header once the reply passes its sticky threshold")
      const tail = [...host.querySelectorAll<HTMLElement>('[data-reply-scope] p')].find(element => element.textContent === streamingTail)!
      const tailRect = tail.getBoundingClientRect(), tailHit = document.elementFromPoint(tailRect.left + Math.min(80, tailRect.width / 2), tailRect.top + tailRect.height / 2)
      check(!!tailHit && tail.contains(tailHit), "Summary or sticky status covers the newest streaming continuation")
      changeStreaming(false)
      await nextFrame()
    })
    await runCase("Ordinary user bubble", async () => {
      changeStreaming(false)
      await settleLayout()
      const turn = host.querySelector<HTMLElement>('[data-user-message-turn="ordinary-user"]')!
      const bar = turn.querySelector<HTMLElement>('[data-slot="sticky-freeze"]')!
      check(getComputedStyle(bar).position === "sticky", "Ordinary user bubble lost sticky positioning")
      viewport().dispatchEvent(new WheelEvent("wheel", { deltaY: -1, bubbles: true }))
      viewport().scrollTop += turn.getBoundingClientRect().top - viewport().getBoundingClientRect().top + 180
      await nextFrame()
      check(Math.abs(bar.getBoundingClientRect().top - viewport().getBoundingClientRect().top - AGENT_CHAT_HEADER_HEIGHT) <= 1, "Ordinary user bubble no longer pins below the chat header")
    })
    await scrollToEnd()
    output.textContent = failures.length ? `FAIL ${failures.join("; ")} (${count} checks passed)` : `PASS ${count} compact thread checks`
  } catch (error) { output.textContent = `FAIL ${error instanceof Error ? error.message : error}` }
  finally { button.disabled = false }
})
