"use client"

import * as React from "react"
import { ChevronRightIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar"
import type { AppView } from "@/lib/app-view"

import type {
  SidebarAnimatedIconHandle,
  SidebarNavItem,
} from "../sidebar.types"

function NavMenuItem({
  item,
  activeView,
  onNewAgentMessage,
  onViewChange,
}: {
  item: SidebarNavItem
  activeView: AppView
  onNewAgentMessage?: () => void
  onViewChange: (view: AppView) => void
}) {
  const { t } = useTranslation()
  const { isMobile, setOpenMobile } = useSidebar()
  const iconRef = React.useRef<SidebarAnimatedIconHandle>(null)
  const Icon = item.icon
  const title = t(item.titleKey)
  const hasSubmenu = Boolean(item.items?.length)
  const isItemActive = item.view === activeView
  const hasActiveSubmenuItem = Boolean(
    item.items?.some((subItem) => subItem.view === activeView)
  )
  const [submenuOpen, setSubmenuOpen] = React.useState(
    hasActiveSubmenuItem
  )
  const iconAnimationHandlers = {
    onMouseEnter: () => iconRef.current?.startAnimation(),
    onMouseLeave: () => iconRef.current?.stopAnimation(),
    onFocus: () => iconRef.current?.startAnimation(),
    onBlur: () => iconRef.current?.stopAnimation(),
  }

  React.useEffect(() => {
    if (hasActiveSubmenuItem) {
      setSubmenuOpen(true)
    }
  }, [hasActiveSubmenuItem])

  const closeMobileSidebar = () => {
    if (isMobile) {
      setOpenMobile(false)
    }
  }

  const selectView = (view?: AppView) => {
    if (!view) {
      return
    }

    onViewChange(view)
    closeMobileSidebar()
  }

  const selectItem = () => {
    if (item.action === "new-agent-message") {
      onNewAgentMessage?.()
      closeMobileSidebar()
      return
    }

    selectView(item.view)
  }

  const content = (
    <>
      <Icon
        ref={iconRef}
        size={16}
        className="size-4 shrink-0"
        aria-hidden="true"
      />
      <span>{title}</span>
      {hasSubmenu && (
        <ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-open/collapsible:rotate-90" />
      )}
    </>
  )

  if (!hasSubmenu) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          isActive={isItemActive}
          tooltip={title}
          onClick={selectItem}
          {...iconAnimationHandlers}
        >
          {content}
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }

  return (
    <Collapsible
      open={submenuOpen}
      onOpenChange={setSubmenuOpen}
      className="group/collapsible"
      render={<SidebarMenuItem />}
    >
      <CollapsibleTrigger
        render={
          <SidebarMenuButton
            isActive={hasActiveSubmenuItem}
            tooltip={title}
            {...iconAnimationHandlers}
          />
        }
      >
        {content}
      </CollapsibleTrigger>
      <CollapsibleContent className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height,opacity] duration-200 ease-out data-[ending-style]:h-0 data-[ending-style]:opacity-0 data-[starting-style]:h-0 data-[starting-style]:opacity-0">
        <SidebarMenuSub>
          {item.items?.map((subItem) => (
            <SidebarMenuSubItem key={subItem.titleKey}>
              <SidebarMenuSubButton
                render={<button type="button" />}
                className="w-full text-left"
                isActive={subItem.view === activeView}
                onClick={() => selectView(subItem.view)}
              >
                {subItem.icon}
                <span>{t(subItem.titleKey)}</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function NavMenu({
  items,
  activeView,
  onNewAgentMessage,
  onViewChange,
}: {
  items: SidebarNavItem[]
  activeView: AppView
  onNewAgentMessage?: () => void
  onViewChange: (view: AppView) => void
}) {
  return (
    <SidebarGroup>
      <SidebarMenu>
        {items.map((item) => (
          <NavMenuItem
            key={item.titleKey}
            item={item}
            activeView={activeView}
            onNewAgentMessage={onNewAgentMessage}
            onViewChange={onViewChange}
          />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
