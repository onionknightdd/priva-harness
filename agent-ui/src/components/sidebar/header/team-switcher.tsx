"use client"

import * as React from "react"
import { CheckIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"

import type { SidebarTeam } from "../sidebar.types"

export function TeamSwitcher({ teams }: { teams: SidebarTeam[] }) {
  const { isMobile, setOpen, state } = useSidebar()
  const { t } = useTranslation()
  const [activeTeam, setActiveTeam] = React.useState(teams[0])
  const [teamMenuOpen, setTeamMenuOpen] = React.useState(false)

  React.useEffect(() => {
    if (!isMobile && state === "collapsed") {
      setTeamMenuOpen(false)
    }
  }, [isMobile, state])

  if (!activeTeam) {
    return null
  }

  return (
    <div className="flex items-center gap-1">
      <SidebarMenu className="min-w-0 flex-1">
        <SidebarMenuItem>
          <DropdownMenu
            open={teamMenuOpen}
            onOpenChange={(open) => {
              if (open && !isMobile && state === "collapsed") {
                setOpen(true)
                return
              }
              setTeamMenuOpen(open)
            }}
          >
            <DropdownMenuTrigger
              aria-label={
                !isMobile && state === "collapsed"
                  ? t("common.expandSidebar")
                  : undefined
              }
              title={
                !isMobile && state === "collapsed"
                  ? t("common.expandSidebar")
                  : undefined
              }
              render={
                <SidebarMenuButton
                  size="lg"
                  className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
                />
              }
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground [&>svg]:size-4">
                {activeTeam.logo}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{activeTeam.name}</span>
                <span className="truncate text-xs">
                  {t(activeTeam.planKey)}
                </span>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {teams.map((team) => (
                <DropdownMenuItem
                  key={team.name}
                  onSelect={() => setActiveTeam(team)}
                >
                  {team.name}
                  {team === activeTeam && (
                    <CheckIcon className="ml-auto" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <SidebarTrigger
        className="shrink-0 group-data-[collapsible=icon]:hidden"
        aria-label={t("common.collapseSidebar")}
        title={t("common.collapseSidebar")}
      />
    </div>
  )
}
