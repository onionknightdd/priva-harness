"use client"

import * as React from "react"
import gsap from "gsap"

import type { AppView } from "@/lib/app-view"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar"

import { NavMenu } from "./content/nav-menu"
import { NavProjects } from "./content/nav-projects"
import { NavUser } from "./footer/nav-user"
import { HarnessSwitcher } from "./header/harness-switcher"
import { SidebarModeTabs } from "./header/sidebar-mode-tabs"
import { sidebarData } from "./sidebar-data"

export function AppSidebar({
  activeView,
  onNewChat,
  onViewChange,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  activeView: AppView
  onNewChat?: () => void
  onViewChange: (view: AppView) => void
}) {
  const footerFadeRef = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    const footerFade = footerFadeRef.current

    if (
      !footerFade ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        footerFade,
        { opacity: 0 },
        {
          opacity: 1,
          duration: 0.24,
          ease: "power1.out",
          clearProps: "opacity",
        }
      )
    }, footerFade)

    return () => context.revert()
  }, [])

  return (
    <Sidebar collapsible="icon" resizable {...props}>
      <SidebarHeader>
        <HarnessSwitcher />
        <SidebarModeTabs />
      </SidebarHeader>
      <SidebarContent>
        <NavMenu
          items={sidebarData.menu}
          activeView={activeView}
          onNewChat={onNewChat}
          onViewChange={onViewChange}
        />
        <NavProjects projects={sidebarData.projects} />
      </SidebarContent>
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
