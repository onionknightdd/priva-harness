import { UploadQueueProvider } from "../../../../src/features/uploads/upload-queue-provider"
import * as React from "react"
import { createRoot } from "react-dom/client"
import { MotionConfig } from "motion/react"
import { ThemeProvider } from "next-themes"
import { SidebarModeTabs } from "../../../../src/features/sidebar/header/sidebar-mode-tabs"
import { HarnessProvider, useHarness } from "../../../../src/features/sidebar/header/harness-context"
import { AgentPreferencesProvider } from "../../../../src/features/settings/agent-preferences-context"
import { ChatSessionProvider, useActiveSession, useChatSessionActions } from "../../../../src/features/chat-session"
import { TooltipProvider } from "../../../../src/components/ui/tooltip"
import { installProjectDirectoryFixtures } from "../../project-directory/project-directory-fixtures"
import { SessionViewProvider } from "../../../../src/features/agent-message/session-view-context"
import { useAgentMessage } from "../../../../src/features/agent-message/use-agent-message"
import i18n from "../../../../src/i18n"
import "../../../../src/index.css"

const params = new URLSearchParams(location.search)
localStorage.setItem("agent-ui-agent-preferences", JSON.stringify({ defaultHarness: "last-used", lastHarnessId: "claude" }))
await i18n.changeLanguage(params.has("zh") ? "zh-CN" : "en")
const fixture = installProjectDirectoryFixtures()
const wait = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))
let checks: () => Promise<void> = async () => undefined

function Page() {
  const active = useActiveSession()
  const actions = useChatSessionActions()
  const harness = useHarness()
  const agent = useAgentMessage()
  const [width, setWidth] = React.useState(280)
  const [result, setResult] = React.useState("Ready")
  const latest = React.useRef({ active, actions, agent })
  latest.current = { active, actions, agent }
  const assert = (condition: unknown, text: string) => { if (!condition) throw new Error(text) }
  checks = async () => {
    setResult("Running…")
    try {
      actions.startNewChat("/workspace/work/existing")
      await wait()
      assert(latest.current.active.runMode === "agent", "New chats default to Agent")
      const code = Array.from(document.querySelectorAll<HTMLButtonElement>('[role=tab]')).find((item) => item.textContent === 'Code')!
      code.click(); await wait()
      assert(latest.current.active.runMode === "code", "Tabs update the draft mode")
      latest.current.agent.setDraft("Mode probe")
      latest.current.agent.setModelReference("test:test-model")
      await wait()
      latest.current.agent.submit(); await wait()
      assert(latest.current.active.runModeLocked, "Sending the first turn locks the switch immediately")
      const socket = fixture.sockets.at(-1)!
      const init = socket.sent.find((frame) => frame.type === 'run.start')!
      assert(init.runMode === 'code', "Claude frame contains Code")
      socket.reply({ v: 2, type: 'error', code: 'run.start', runId: init.runId, message: 'Fixture startup failure' })
      await wait()
      assert(!latest.current.active.runModeLocked, "A failed initial launch unlocks the draft")
      latest.current.agent.setDraft("Retry mode probe"); await wait(); latest.current.agent.submit(); await wait()
      const retry = socket.sent.filter((frame) => frame.type === 'run.start').at(-1)!
      socket.reply({ v: 2, type: 'session.config', sessionId: 'bound-code', streamId: 'modes', seq: 1,
        config: { model: 'test-model', cwd: '/workspace/work/existing', runMode: 'code', context: { used: null, limit: null, categories: [] } } })
      socket.reply({ v: 2, type: 'run.completed', runId: retry.runId, sessionId: 'bound-code', streamId: 'modes', seq: 2 })
      await wait()
      assert(latest.current.active.runMode === 'code' && latest.current.active.runModeLocked, "Server binding preserves and locks Code")
      latest.current.actions.setDraftRunMode('agent'); await wait()
      assert(latest.current.active.runMode === 'code', "Bound sessions cannot change mode")
      socket.reply({ v: 2, type: 'session.rebound', sessionId: 'bound-code', nextSessionId: 'native-agent', streamId: 'modes', seq: 3 })
      await wait()
      socket.reply({ v: 2, type: 'session.snapshot', sessionId: 'native-agent', streamId: 'agent-mode', seq: 1, messages: [], tasks: [],
        config: { model: 'test-model', cwd: '/workspace/work/existing', runMode: 'agent', context: { used: null, limit: null, categories: [] } } })
      await wait()
      assert(latest.current.active.runMode === 'agent' && latest.current.active.runModeLocked, 'Native rebind and snapshot restore the target mode')
      const help = document.querySelector<HTMLButtonElement>('[data-slot=dialog-trigger]')!
      help.click(); await wait()
      assert(document.querySelector('[role=dialog] table')?.querySelectorAll('tbody tr').length === 5, "Help opens the comparison table")
      document.querySelector<HTMLButtonElement>('[data-slot=dialog-close]')!.click(); await wait(300)
      setWidth(164); await wait(500)
      assert(help.isConnected && help.getBoundingClientRect().width > 0, "Narrow sidebars retain help")
      const row = document.getElementById('mode-row')!
      assert(row.scrollWidth <= row.clientWidth, "Narrow row does not overflow")
      harness.setHarnessId('pi'); await wait()
      assert(!row.querySelector('[role=tablist]') && !row.querySelector('[data-slot=dialog-trigger]'), "Pi hides the entire mode row")
      latest.current.agent.setDraft('Pi probe'); latest.current.agent.setModelReference('test:test-model'); await wait()
      latest.current.agent.submit(); await wait()
      const piFrame = fixture.sockets.at(-1)!.sent.find((frame) => frame.type === 'run.start')!
      assert(piFrame.harness === 'pi' && !('runMode' in piFrame), "Pi requests preserve their existing shape")
      harness.setHarnessId('claude'); await wait(); setWidth(280)
      assert(latest.current.active.runMode === 'agent', 'Returning to Claude starts an Agent draft')
      setResult('PASS: draft selection, request, startup failure, binding, locking, native rebind, comparison, narrow width, Pi visibility and request')
    } catch (error) { setResult(`FAIL: ${String(error)}`); throw error }
  }
  return <main className="min-h-screen bg-background p-6 text-foreground">
    <button id="run-checks" onClick={() => void checks()} className="mb-4 rounded border p-2">Run mode checks</button>
    <pre id="results" className="mb-4 whitespace-pre-wrap text-sm" role="status">{result}</pre>
    <div id="mode-row" style={{ width }}><SidebarModeTabs /></div>
    <div className="mt-4 flex gap-3 text-sm">
      <button onClick={() => setWidth(width === 280 ? 164 : 280)}>Toggle width</button>
      <button onClick={() => harness.setHarnessId(harness.runHarnessId === 'claude' ? 'pi' : 'claude')}>Switch harness</button>
      <button onClick={() => actions.startNewChat()}>New chat</button>
    </div>
  </main>
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider attribute="class" forcedTheme={params.has('dark') ? 'dark' : 'light'}>
    <MotionConfig reducedMotion={params.has('reduced-motion') ? 'always' : 'user'}>
      <AgentPreferencesProvider><HarnessProvider><ChatSessionProvider><SessionViewProvider><UploadQueueProvider><TooltipProvider><Page /></TooltipProvider></UploadQueueProvider></SessionViewProvider></ChatSessionProvider></HarnessProvider></AgentPreferencesProvider>
    </MotionConfig>
  </ThemeProvider>,
)
