import * as React from "react"
import { GalleryVerticalEndIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { WorkspaceShell } from "@/features/workspace"
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

const AgentMessagePage = React.lazy(async () => {
  const module = await import("@/features/agent-message")

  return { default: module.AgentMessagePage }
})

const FileBrowserPage = React.lazy(async () => {
  const module = await import("@/features/file-browser")

  return { default: module.FileBrowserPage }
})

function MobileSidebarLogoTrigger({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation()

  return (
    <Button
      className="md:hidden"
      size="icon"
      onClick={onOpen}
      aria-label={t("common.openSidebar")}
      title={t("common.openSidebar")}
    >
      <GalleryVerticalEndIcon />
    </Button>
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
}: {
  activeView: AppView
  agentMessageSessionKey: number
}) {
  const { setOpenMobile } = useSidebar()
  const { t } = useTranslation()
  const isFileBrowser = activeView === "file-browser"
  const workspaceEnabled = !isSidebarContentView(activeView)

  return (
    <WorkspaceShell workspaceEnabled={workspaceEnabled}>
      <header
        className={cn(
          "relative z-20 flex shrink-0 items-center gap-2",
          isFileBrowser ? "h-10" : "h-[35px] pt-[5px]"
        )}
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
          {isFileBrowser ? (
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <span>{t("breadcrumb.dataAndUsage")}</span>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>
                    {t("breadcrumb.fileBrowser")}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          ) : (
            <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
              {t("agentMessage.testSessionTitle")}
            </h1>
          )}
        </div>
        {isFileBrowser ? null : (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-full h-6 bg-linear-to-b from-background to-transparent"
          />
        )}
      </header>
      {isFileBrowser ? (
        <React.Suspense fallback={<AgentLayoutFallback />}>
          <FileBrowserPage />
        </React.Suspense>
      ) : (
        <React.Suspense fallback={<AgentLayoutFallback />}>
          <AgentMessagePage key={agentMessageSessionKey} />
        </React.Suspense>
      )}
    </WorkspaceShell>
  )
}
