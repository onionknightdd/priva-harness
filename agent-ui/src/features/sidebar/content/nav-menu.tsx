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
import { collapsePanel } from "@/lib/surfaces"

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
  const tooltip = item.disabled ? `${title} (${t("common.comingSoon")})` : title
  const hasSubmenu = Boolean(item.items?.length)
  const isItemActive = item.view === activeView
  const hasActiveSubmenuItem = Boolean(
    item.items?.some((subItem) => subItem.view === activeView)
  )
  const [submenuOpen, setSubmenuOpen] = React.useState(
    hasActiveSubmenuItem
  )
  const iconAnimationHandlers = item.disabled ? {} : {
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
      <span className="min-w-0 truncate">{title}</span>
      {item.disabled && (
        <span className="shrink-0 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          ({t("common.comingSoon")})
        </span>
      )}
      {hasSubmenu && (
        <ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-open/collapsible:rotate-90" />
      )}
    </>
  )

  if (!hasSubmenu) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          render={<button type="button" disabled={item.disabled} />}
          isActive={!item.disabled && isItemActive}
          tooltip={tooltip}
          onClick={item.disabled ? undefined : selectItem}
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
        disabled={item.disabled}
        render={
          <SidebarMenuButton
            isActive={!item.disabled && hasActiveSubmenuItem}
            tooltip={tooltip}
            {...iconAnimationHandlers}
          />
        }
      >
        {content}
      </CollapsibleTrigger>
      <CollapsibleContent className={collapsePanel}>
        <SidebarMenuSub>
          {item.items?.map((subItem) => (
            <SidebarMenuSubItem key={subItem.titleKey}>
              <SidebarMenuSubButton
                render={<button type="button" disabled={subItem.disabled} />}
                className="w-full text-left"
                isActive={subItem.view === activeView}
                onClick={
                  subItem.disabled ? undefined : () => selectView(subItem.view)
                }
              >
                {subItem.icon}
                <span className="min-w-0 truncate">
                  {t(subItem.titleKey)}
                </span>
                {subItem.disabled && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    ({t("common.comingSoon")})
                  </span>
                )}
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
