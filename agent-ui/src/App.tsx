import * as React from "react"
import gsap from "gsap"
import { GalleryVerticalEndIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { CanvasShell } from "@/components/canvas"
import { AppSidebar } from "@/components/sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"

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

function AgentWorkspace() {
  const contentRef = React.useRef<HTMLDivElement>(null)
  const { setOpenMobile } = useSidebar()
  const { t } = useTranslation()

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
        "[data-harness-panel]",
        { y: 8, scale: 0.99 },
        {
          y: 0,
          scale: 1,
          duration: 0.35,
          stagger: 0.04,
          ease: "power2.out",
          clearProps: "transform",
        }
      )
    }, content)

    return () => context.revert()
  }, [])

  return (
    <CanvasShell>
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
                <BreadcrumbLink href="#">
                  {t("breadcrumb.buildYourApplication")}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>
                  {t("breadcrumb.dataFetching")}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <div ref={contentRef} className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div className="grid auto-rows-min gap-4 md:grid-cols-3">
          <div
            data-harness-panel
            className="aspect-video rounded-xl bg-muted/50"
          />
          <div
            data-harness-panel
            className="aspect-video rounded-xl bg-muted/50"
          />
          <div
            data-harness-panel
            className="aspect-video rounded-xl bg-muted/50"
          />
        </div>
        <div
          data-harness-panel
          className="min-h-[100vh] flex-1 rounded-xl bg-muted/50 md:min-h-min"
        />
      </div>
    </CanvasShell>
  )
}

function AgentHarness() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <AgentWorkspace />
    </SidebarProvider>
  )
}

export default function App() {
  return (
    <TooltipProvider>
      <AgentHarness />
    </TooltipProvider>
  )
}
