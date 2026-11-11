import * as React from "react"
import { GalleryVerticalEndIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { WorkspaceShell } from "@/features/workspace"
import { AgentChatHeader } from "@/features/agent-message/components/agent-chat-header"
import { AGENT_CHAT_HEADER_HEIGHT } from "@/features/agent-message/agent-chat-layout"
import { SessionViewProvider } from "@/features/agent-message/session-view-context"
import { useActiveSession } from "@/features/chat-session"
import {
  isSidebarContentView,
  type AppView,
} from "@/lib/app-view"
import { cn } from "@/lib/utils"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { useSidebar } from "@/components/ui/sidebar"
import { TooltipHint } from "@/components/ui/tooltip"

const AgentMessagePage = React.lazy(async () => {
  const module = await import("@/features/agent-message")

  return { default: module.AgentMessagePage }
})

const FileBrowserPage = React.lazy(async () => {
  const module = await import("@/features/file-browser")

  return { default: module.FileBrowserPage }
})

const ResourcePage = React.lazy(async () => {
  const module = await import("@/features/resources/resource-page")
  return { default: module.ResourcePage }
})

const UsagePage = React.lazy(async () => {
  const module = await import("@/features/usage")

  return { default: module.UsagePage }
})

function MobileSidebarLogoTrigger({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation()

  return (
    <TooltipHint content={t("common.openSidebar")}>
      <Button
        className="md:hidden"
        size="icon"
        onClick={onOpen}
        aria-label={t("common.openSidebar")}
      >
        <GalleryVerticalEndIcon />
      </Button>
    </TooltipHint>
  )
}

function AgentLayoutFallback() {
  const { t } = useTranslation()

  return (
    <div
      role="status"
      aria-label={t("common.loading")}
      className="flex min-h-0 flex-1 flex-col gap-3 p-4 pt-0"
    >
      <Skeleton className="h-9 w-full sm:max-w-sm" />
      <Skeleton className="min-h-56 flex-1 rounded-xl" />
    </div>
  )
}

export function AgentLayout({
  activeView,
  agentMessageSessionKey,
  onShowChat,
}: {
  activeView: AppView
  agentMessageSessionKey: number
  onShowChat?: () => void
}) {
  const { setOpenMobile } = useSidebar()
  const { t } = useTranslation()
  const { activeSession, runSessionId } = useActiveSession()
  const viewedSessionId = activeSession?.sessionId ?? runSessionId
  const isFileBrowser = activeView === "file-browser"
  const isResource = activeView === "skills" || activeView === "mcp"
  const isUsage = activeView === "usage"
  const isChat = !isFileBrowser && !isResource && !isUsage
  const workspaceEnabled = !isSidebarContentView(activeView)
  const breadcrumb = isResource
    ? { section: t("resources.plugins"), page: t(`resources.${activeView}`) }
    : isFileBrowser
      ? { section: t("breadcrumb.dataAndUsage"), page: t("breadcrumb.fileBrowser") }
      : isUsage
        ? { section: t("breadcrumb.dataAndUsage"), page: t("breadcrumb.usage") }
        : null

  return (
    <SessionViewProvider chatKey={String(agentMessageSessionKey)} sessionId={viewedSessionId}>
    <WorkspaceShell workspaceEnabled={workspaceEnabled} onShowChat={onShowChat}>
      <header
        data-slot={isChat ? "agent-chat-header" : undefined}
        className={cn(
          "flex shrink-0 items-center gap-2",
          isChat ? "relative z-30" : "z-20",
          isFileBrowser ? "h-10" : "pt-[5px]",
          !isChat && !isFileBrowser && "h-[35px]"
        )}
        style={isChat ? { height: AGENT_CHAT_HEADER_HEIGHT } : undefined}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 px-4">
          <div className="flex items-center gap-2 md:hidden">
            <MobileSidebarLogoTrigger
              onOpen={() => setOpenMobile(true)}
            />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
          </div>
          {breadcrumb ? (
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <span>{breadcrumb.section}</span>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>{breadcrumb.page}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          ) : (
            <AgentChatHeader />
          )}
        </div>
      </header>
      {isChat ? (
        <React.Suspense fallback={<AgentLayoutFallback />}>
          <AgentMessagePage key={agentMessageSessionKey} />
        </React.Suspense>
      ) : (
        // Keyed per view so each switch replays the shared enter motion. The
        // chat keeps its own composer choreography, and the file browser
        // staggers its own regions in, so both are left out.
        <div
          key={activeView}
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col",
            !isFileBrowser && "view-enter"
          )}
        >
          <React.Suspense fallback={<AgentLayoutFallback />}>
            {isResource ? (
              <ResourcePage key={activeView} kind={activeView} />
            ) : isUsage ? (
              <UsagePage />
            ) : (
              <FileBrowserPage />
            )}
          </React.Suspense>
        </div>
      )}
    </WorkspaceShell>
    </SessionViewProvider>
  )
}
