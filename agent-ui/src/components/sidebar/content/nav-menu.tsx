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
} from "@/components/ui/sidebar"

import type {
  SidebarAnimatedIconHandle,
  SidebarNavItem,
} from "../sidebar.types"

function NavMenuItem({ item }: { item: SidebarNavItem }) {
  const { t } = useTranslation()
  const iconRef = React.useRef<SidebarAnimatedIconHandle>(null)
  const Icon = item.icon
  const title = t(item.titleKey)
  const hasSubmenu = Boolean(item.items?.length)
  const iconAnimationHandlers = {
    onMouseEnter: () => iconRef.current?.startAnimation(),
    onMouseLeave: () => iconRef.current?.stopAnimation(),
    onFocus: () => iconRef.current?.startAnimation(),
    onBlur: () => iconRef.current?.stopAnimation(),
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
          render={<a href={item.url} />}
          tooltip={title}
          {...iconAnimationHandlers}
        >
          {content}
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }

  return (
    <Collapsible
      className="group/collapsible"
      render={<SidebarMenuItem />}
    >
      <CollapsibleTrigger
        render={
          <SidebarMenuButton
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
              <SidebarMenuSubButton render={<a href={subItem.url} />}>
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

export function NavMenu({ items }: { items: SidebarNavItem[] }) {
  return (
    <SidebarGroup>
      <SidebarMenu>
        {items.map((item) => (
          <NavMenuItem key={item.titleKey} item={item} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
