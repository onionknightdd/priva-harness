"use client"

import * as React from "react"
import { motion } from "motion/react"

import type { AppView } from "@/lib/app-view"
import type { SessionInfo } from "@/lib/api/sandbox-sessions"
import { useChatSessionActions } from "@/features/chat-session"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar"

import { NavMenu } from "./content/nav-menu"
import { NavProjects } from "./content/nav-projects"
import { NavUser } from "./footer/nav-user"
import { HarnessSwitcher } from "./header/harness-switcher"
import { SidebarModeTabs } from "./header/sidebar-mode-tabs"
import { sidebarData } from "./sidebar-data"
import { playEnter } from "@/lib/motion-effects"

const ScrollableSidebarContent = motion.create(SidebarContent)

export function AppSidebar({
  activeView,
  onNewAgentMessage,
  onCreateProjectSession,
  onViewChange,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  activeView: AppView
  onNewAgentMessage?: () => void
  onCreateProjectSession?: (cwd: string) => void
  onViewChange: (view: AppView) => void
}) {
  const footerFadeRef = React.useRef<HTMLDivElement>(null)
  const { openSession } = useChatSessionActions()
  const { isMobile, setOpenMobile } = useSidebar()
  const selectSession = React.useCallback(
    (session: SessionInfo) => {
      onViewChange("agent-message")
      openSession(session)
      // The phone sidebar covers the chat; choosing a session reveals it.
      if (isMobile) setOpenMobile(false)
    },
    [isMobile, onViewChange, openSession, setOpenMobile]
  )

  React.useLayoutEffect(
    () => playEnter(footerFadeRef.current, { duration: 240 }),
    []
  )

  return (
    <Sidebar collapsible="icon" resizable {...props}>
      <SidebarHeader>
        <HarnessSwitcher />
        <SidebarModeTabs />
      </SidebarHeader>
      <ScrollableSidebarContent layoutScroll>
        <NavMenu
          items={sidebarData.menu}
          activeView={activeView}
          onNewAgentMessage={onNewAgentMessage}
          onViewChange={onViewChange}
        />
        <NavProjects
          onSelectSession={selectSession}
          onCreateSession={(cwd) => {
            onViewChange("agent-message")
            onCreateProjectSession?.(cwd)
            if (isMobile) setOpenMobile(false)
          }}
        />
      </ScrollableSidebarContent>
      <SidebarFooter className="relative z-20 bg-sidebar">
        <div
          ref={footerFadeRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-linear-to-t from-sidebar to-transparent"
        />
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
