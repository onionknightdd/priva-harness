import * as React from "react"

import { AgentLayout } from "@/app/agent-layout"
import { AppSidebar } from "@/features/sidebar"
import { UploadQueueProvider } from "@/features/uploads"
import type { AppView } from "@/lib/app-view"
import { SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"

function AgentHarness() {
  const [activeView, setActiveView] = React.useState<AppView>("agent-message")
  const [agentMessageSessionKey, setAgentMessageSessionKey] = React.useState(0)

  const startNewAgentMessage = React.useCallback(() => {
    setActiveView("agent-message")
    setAgentMessageSessionKey((currentKey) => currentKey + 1)
  }, [])

  return (
    <SidebarProvider className="h-svh min-h-0 overflow-hidden">
      <AppSidebar
        activeView={activeView}
        onNewAgentMessage={startNewAgentMessage}
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
        <AgentHarness />
      </UploadQueueProvider>
    </TooltipProvider>
  )
}
