import * as React from "react"

import { AgentWorkspace } from "@/app/agent-workspace"
import { AppSidebar } from "@/features/sidebar"
import { UploadQueueProvider } from "@/features/uploads"
import type { AppView } from "@/lib/app-view"
import { SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"

function AgentHarness() {
  const [activeView, setActiveView] = React.useState<AppView>("workspace")
  const [chatSessionKey, setChatSessionKey] = React.useState(0)

  const startNewChat = React.useCallback(() => {
    setActiveView("workspace")
    setChatSessionKey((currentKey) => currentKey + 1)
  }, [])

  return (
    <SidebarProvider className="h-svh min-h-0 overflow-hidden">
      <AppSidebar
        activeView={activeView}
        onNewChat={startNewChat}
        onViewChange={setActiveView}
      />
      <AgentWorkspace
        activeView={activeView}
        chatSessionKey={chatSessionKey}
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
