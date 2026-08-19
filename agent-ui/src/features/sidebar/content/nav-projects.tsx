"use client"

import * as React from "react"
import { FolderIcon } from "@animateicons/react/lucide"
import {
  ArchiveIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PinIcon,
  TagIcon,
} from "lucide-react"
import { motion, useReducedMotion, type Transition } from "motion/react"
import { useTranslation } from "react-i18next"

import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

import type {
  SidebarAnimatedIconHandle,
  SidebarProject,
} from "../sidebar.types"
import { ProjectHeader } from "./project-header"

const emptyStateTransition: Transition = {
  type: "spring",
  stiffness: 360,
  damping: 30,
}

function ProjectMenuItem({
  item,
  isMobile,
  reduceMotion,
}: {
  item: SidebarProject
  isMobile: boolean
  reduceMotion: boolean
}) {
  const { t } = useTranslation()
  const folderIconRef = React.useRef<SidebarAnimatedIconHandle>(null)
  const iconAnimationHandlers = {
    onMouseEnter: () => {
      if (!reduceMotion) folderIconRef.current?.startAnimation()
    },
    onMouseLeave: () => folderIconRef.current?.stopAnimation(),
    onFocus: () => {
      if (!reduceMotion) folderIconRef.current?.startAnimation()
    },
    onBlur: () => folderIconRef.current?.stopAnimation(),
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<a href={item.url} />}
        {...iconAnimationHandlers}
      >
        <FolderIcon
          ref={folderIconRef}
          size={16}
          isAnimated={!reduceMotion}
          className="size-4 shrink-0"
          aria-hidden="true"
        />
        <span>{item.name}</span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuAction
              showOnHover
              className="aria-expanded:bg-muted"
            />
          }
        >
          <MoreHorizontalIcon />
          <span className="sr-only">{t("common.more")}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-fit"
          side={isMobile ? "bottom" : "right"}
          align={isMobile ? "end" : "start"}
        >
          <DropdownMenuItem>
            <PinIcon />
            <span>{t("sidebar.projects.pin")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <TagIcon />
            <span>{t("sidebar.projects.tag")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <FolderOpenIcon />
            <span>{t("sidebar.projects.revealInFiles")}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            <ArchiveIcon />
            <span>{t("sidebar.projects.archive")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

export function NavProjects({
  projects,
}: {
  projects: SidebarProject[]
}) {
  const { isMobile } = useSidebar()
  const { t } = useTranslation()
  const [projectQuery, setProjectQuery] = React.useState("")
  const [projectsOpen, setProjectsOpen] = React.useState(true)
  const projectListId = React.useId()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const normalizedQuery = projectQuery.trim().toLocaleLowerCase()
  const filteredProjects = React.useMemo(
    () =>
      normalizedQuery
        ? projects.filter((project) =>
            project.name.toLocaleLowerCase().includes(normalizedQuery)
          )
        : projects,
    [normalizedQuery, projects]
  )

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <Collapsible
        open={projectsOpen}
        onOpenChange={setProjectsOpen}
        className="w-full"
      >
        <ProjectHeader
          query={projectQuery}
          onQueryChange={setProjectQuery}
          projectsOpen={projectsOpen}
          onProjectsOpenChange={setProjectsOpen}
          projectListId={projectListId}
        />
        <CollapsibleContent
          id={projectListId}
          className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height,opacity] duration-200 ease-out data-[ending-style]:h-0 data-[ending-style]:opacity-0 data-[starting-style]:h-0 data-[starting-style]:opacity-0"
        >
          <SidebarMenu>
            {filteredProjects.map((item) => (
              <ProjectMenuItem
                key={item.name}
                item={item}
                isMobile={isMobile}
                reduceMotion={shouldReduceMotion}
              />
            ))}
            {filteredProjects.length === 0 && (
              <SidebarMenuItem>
                <motion.p
                  role="status"
                  className="flex h-8 items-center px-2 text-xs text-sidebar-foreground/60"
                  initial={
                    shouldReduceMotion ? false : { opacity: 0, y: -3 }
                  }
                  animate={{ opacity: 1, y: 0 }}
                  transition={
                    shouldReduceMotion
                      ? { duration: 0 }
                      : emptyStateTransition
                  }
                >
                  {t(
                    projects.length === 0 && !normalizedQuery
                      ? "sidebar.projects.empty"
                      : "sidebar.projects.noResults"
                  )}
                </motion.p>
              </SidebarMenuItem>
            )}
            {projects.length > 0 && (
              <SidebarMenuItem>
                <SidebarMenuButton className="text-sidebar-foreground/70">
                  <MoreHorizontalIcon className="text-sidebar-foreground/70" />
                  <span>{t("common.more")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </CollapsibleContent>
      </Collapsible>
    </SidebarGroup>
  )
}
