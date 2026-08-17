"use client"

import * as React from "react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar"

import { NavMenu } from "./content/nav-menu"
import { NavProjects } from "./content/nav-projects"
import { NavUser } from "./footer/nav-user"
import { SidebarModeTabs } from "./header/sidebar-mode-tabs"
import { TeamSwitcher } from "./header/team-switcher"
import { sidebarData } from "./sidebar-data"

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" resizable {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={sidebarData.teams} />
        <SidebarModeTabs />
      </SidebarHeader>
      <SidebarContent>
        <NavMenu items={sidebarData.menu} />
        <NavProjects projects={sidebarData.projects} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={sidebarData.user} />
      </SidebarFooter>
    </Sidebar>
  )
}
