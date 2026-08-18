"use client"

import * as React from "react"
import gsap from "gsap"
import {
  ArchiveIcon,
  BotIcon,
  BugIcon,
  MessageSquareIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  UserRoundIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { ModelSettingsView } from "@/features/model-settings"
import { cn } from "@/lib/utils"

const settingsNavigation = [
  {
    id: "account",
    titleKey: "settings.sections.account",
    icon: UserRoundIcon,
  },
  {
    id: "llmProviders",
    titleKey: "settings.sections.llmProviders",
    icon: BotIcon,
  },
  {
    id: "dm",
    titleKey: "settings.sections.dm",
    icon: MessageSquareIcon,
  },
  {
    id: "personalization",
    titleKey: "settings.sections.personalization",
    icon: SlidersHorizontalIcon,
  },
  {
    id: "advanced",
    titleKey: "settings.sections.advanced",
    icon: SettingsIcon,
  },
  {
    id: "debug",
    titleKey: "settings.sections.debug",
    icon: BugIcon,
  },
  {
    id: "archived",
    titleKey: "settings.sections.archived",
    icon: ArchiveIcon,
  },
] as const

type SettingsSectionId = (typeof settingsNavigation)[number]["id"]

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [activeSectionId, setActiveSectionId] =
    React.useState<SettingsSectionId>("account")
  const panelRef = React.useRef<HTMLDivElement>(null)
  const { t } = useTranslation()
  const activeSection =
    settingsNavigation.find((item) => item.id === activeSectionId) ??
    settingsNavigation[0]
  const activeSectionTitle = t(activeSection.titleKey)
  const isModelSection = activeSectionId === "llmProviders"

  React.useLayoutEffect(() => {
    const panel = panelRef.current

    if (
      !open ||
      !panel ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        panel,
        { autoAlpha: 0.65, y: 6 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.22,
          ease: "power2.out",
          clearProps: "opacity,transform,visibility",
        }
      )
    }, panel)

    return () => context.revert()
  }, [activeSectionId, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="overflow-hidden p-0 md:max-h-[600px] md:max-w-[840px] lg:max-w-[960px]"
        closeButtonClassName="top-2"
      >
        <DialogTitle className="sr-only">{t("settings.title")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("settings.description")}
        </DialogDescription>

        <SidebarProvider
          className="min-h-0 items-start"
          style={{ "--sidebar-width": "12.8rem" } as React.CSSProperties}
        >
          <Sidebar collapsible="none" className="hidden md:flex">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {settingsNavigation.map((item) => {
                      const Icon = item.icon
                      const isActive = item.id === activeSectionId

                      return (
                        <SidebarMenuItem key={item.id}>
                          <SidebarMenuButton
                            type="button"
                            isActive={isActive}
                            className="text-xs [&_svg]:size-3.5"
                            aria-current={isActive ? "page" : undefined}
                            onClick={() => setActiveSectionId(item.id)}
                          >
                            <Icon aria-hidden="true" />
                            <span>{t(item.titleKey)}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      )
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>

          <main className="flex h-[min(576px,calc(100svh-2rem))] min-w-0 flex-1 flex-col overflow-hidden">
            <header className="flex h-12 shrink-0 items-center gap-2">
              <div className="flex min-w-0 items-center gap-2 px-4 pr-14">
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem className="hidden md:block">
                      <BreadcrumbLink render={<span />}>
                        {t("settings.title")}
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem>
                      <BreadcrumbPage id="settings-active-section">
                        {activeSectionTitle}
                      </BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
            </header>

            <section
              className={cn(
                "flex min-h-0 flex-1 flex-col p-4 pt-0",
                isModelSection ? "overflow-hidden" : "overflow-y-auto"
              )}
              aria-labelledby="settings-active-section"
            >
              <div
                key={activeSectionId}
                ref={panelRef}
                data-settings-panel
                className={cn(
                  "flex flex-1 flex-col",
                  !isModelSection && "gap-4"
                )}
              >
                {isModelSection ? (
                  <ModelSettingsView />
                ) : (
                  Array.from({ length: 10 }, (_, index) => (
                    <div
                      key={index}
                      className="aspect-video max-w-3xl rounded-xl bg-muted/50"
                    />
                  ))
                )}
              </div>
            </section>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}
