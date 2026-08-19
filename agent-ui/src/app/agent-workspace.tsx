import * as React from "react"
import gsap from "gsap"
import { useTranslation } from "react-i18next"

import { CanvasShell } from "@/features/canvas"
import {
  isSidebarContentView,
  type AppView,
} from "@/lib/app-view"
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
import { GalleryVerticalEndIcon } from "lucide-react"

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

function WorkspaceEmptyState() {
  const { t } = useTranslation()
  const contentRef = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    const content = contentRef.current

    if (
      !content ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        "[data-workspace-empty]",
        { y: 8, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.32,
          ease: "power2.out",
          clearProps: "transform,opacity",
        }
      )
    }, content)

    return () => context.revert()
  }, [])

  return (
    <div
      ref={contentRef}
      className="flex min-h-0 flex-1 flex-col overflow-auto overscroll-contain p-4 pt-0"
    >
      <div
        data-workspace-empty
        className="flex min-h-0 flex-1 flex-col items-start justify-center gap-2 rounded-xl border border-dashed p-6"
      >
        <p className="text-sm font-medium">{t("workspace.emptyTitle")}</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {t("workspace.emptyDescription")}
        </p>
      </div>
    </div>
  )
}

function WorkspacePageFallback() {
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

export function AgentWorkspace({ activeView }: { activeView: AppView }) {
  const { setOpenMobile } = useSidebar()
  const { t } = useTranslation()
  const isFileBrowser = activeView === "file-browser"
  const canvasEnabled = !isSidebarContentView(activeView)

  const breadcrumbParent = isFileBrowser
    ? t("breadcrumb.dataAndUsage")
    : t("breadcrumb.workspace")
  const breadcrumbPage = isFileBrowser
    ? t("breadcrumb.fileBrowser")
    : t("breadcrumb.conversation")

  return (
    <CanvasShell canvasEnabled={canvasEnabled}>
      <header className="flex h-10 shrink-0 items-center gap-2">
        <div className="flex items-center gap-2 px-4">
          <div className="flex items-center gap-2 md:hidden">
            <MobileSidebarLogoTrigger
              onOpen={() => setOpenMobile(true)}
            />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
          </div>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                <span>{breadcrumbParent}</span>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>{breadcrumbPage}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      {isFileBrowser ? (
        <React.Suspense fallback={<WorkspacePageFallback />}>
          <FileBrowserPage />
        </React.Suspense>
      ) : (
        <WorkspaceEmptyState />
      )}
    </CanvasShell>
  )
}
