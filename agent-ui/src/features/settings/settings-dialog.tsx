"use client"

import * as React from "react"
import {
  ArchiveIcon,
  BotIcon,
  BotMessageSquareIcon,
  BugIcon,
  MessageSquareIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  UserRoundIcon,
} from "lucide-react"
import { motion, useReducedMotion, type Transition } from "motion/react"
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
import { Separator } from "@/components/ui/separator"
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

import { AgentSettingsView } from "./agent-settings-view"

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
    id: "agent",
    titleKey: "settings.sections.agent",
    icon: BotMessageSquareIcon,
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

const settingsPanelTransition: Transition = {
  duration: 0.22,
  ease: [0.22, 1, 0.36, 1],
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [activeSectionId, setActiveSectionId] =
    React.useState<SettingsSectionId>("account")
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const activeSection =
    settingsNavigation.find((item) => item.id === activeSectionId) ??
    settingsNavigation[0]
  const activeSectionTitle = t(activeSection.titleKey)
  const isModelSection = activeSectionId === "llmProviders"
  const isAgentSection = activeSectionId === "agent"

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
                            className="text-sm [&_svg]:size-3.5"
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

          <Separator
            orientation="vertical"
            className="hidden md:block"
          />

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
              <motion.div
                key={activeSectionId}
                data-settings-panel
                className={cn(
                  "flex min-h-0 flex-1 flex-col",
                  !isModelSection && "gap-4"
                )}
                initial={
                  shouldReduceMotion ? false : { opacity: 0.65, y: 6 }
                }
                animate={{ opacity: 1, y: 0 }}
                transition={
                  shouldReduceMotion
                    ? { duration: 0 }
                    : settingsPanelTransition
                }
              >
                {isModelSection ? (
                  <ModelSettingsView />
                ) : isAgentSection ? (
                  <AgentSettingsView />
                ) : (
                  <div className="flex max-w-lg flex-col gap-2 py-2">
                    <p className="text-sm font-medium">
                      {t("settings.unavailableTitle")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t("settings.unavailableDescription")}
                    </p>
                  </div>
                )}
              </motion.div>
            </section>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}
