import * as React from "react"

import { AgentLayout } from "@/app/agent-layout"
import { ChatSessionProvider, useChatSession } from "@/features/chat-session"
import { AgentPreferencesProvider } from "@/features/settings"
import { AppSidebar } from "@/features/sidebar"
import { HarnessProvider } from "@/features/sidebar/header/harness-context"
import { UploadQueueProvider } from "@/features/uploads"
import type { AppView } from "@/lib/app-view"
import { SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"

function AgentHarness() {
  const [activeView, setActiveView] = React.useState<AppView>("agent-message")
  const [agentMessageSessionKey, setAgentMessageSessionKey] = React.useState(0)
  const { startNewChat } = useChatSession()
  const startNewAgentMessage = React.useCallback(() => {
    startNewChat()
    setActiveView("agent-message")
    setAgentMessageSessionKey((currentKey) => currentKey + 1)
  }, [startNewChat])

  const startProjectChat = React.useCallback(
    (cwd: string) => {
      startNewChat(cwd)
      setActiveView("agent-message")
      setAgentMessageSessionKey((currentKey) => currentKey + 1)
    },
    [startNewChat]
  )

  return (
    <SidebarProvider className="h-svh min-h-0 overflow-hidden">
      <AppSidebar
        activeView={activeView}
        onNewAgentMessage={startNewAgentMessage}
        onCreateProjectSession={startProjectChat}
        onViewChange={setActiveView}
      />
      <AgentLayout
        activeView={activeView}
        agentMessageSessionKey={agentMessageSessionKey}
      />
    </SidebarProvider>
  )
}

export default function App() {
  return (
    <TooltipProvider>
      <UploadQueueProvider>
        <AgentPreferencesProvider>
          <HarnessProvider>
            <ChatSessionProvider>
              <AgentHarness />
            </ChatSessionProvider>
          </HarnessProvider>
        </AgentPreferencesProvider>
      </UploadQueueProvider>
    </TooltipProvider>
  )
}
