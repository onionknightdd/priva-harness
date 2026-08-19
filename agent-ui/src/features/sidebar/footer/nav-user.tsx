import * as React from "react"
import {
  BookOpenTextIcon,
  ChevronsUpDownIcon,
  InfoIcon,
  LogOutIcon,
  MessageSquareTextIcon,
  MonitorCogIcon,
  SettingsIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { SettingsDialog } from "@/features/settings"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

import { LanguageToggle } from "./language-toggle"
import { ThemeToggle } from "./theme-toggle"

const menuItemClassName =
  "gap-2 px-2 py-1.5 text-xs [&_svg]:text-muted-foreground"

function UserAvatar({
  className,
  label,
}: {
  className?: string
  label: string
}) {
  return (
    <Avatar className={cn("size-8 rounded-lg after:rounded-lg", className)}>
      <AvatarFallback className="rounded-lg">{label}</AvatarFallback>
    </Avatar>
  )
}

export function NavUser() {
  const { isMobile } = useSidebar()
  const { t } = useTranslation()
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const name = t("sidebar.user.guestName")
  const email = t("sidebar.user.guestEmail")
  const initials = t("sidebar.user.guestInitials")

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem className="flex items-center gap-0.5 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:justify-center">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-0.5 group-data-[collapsible=icon]:hidden">
            <UserAvatar className="size-7" label={initials} />
            <div className="grid min-w-0 flex-1 text-left text-xs leading-tight">
              <span className="truncate font-medium">{name}</span>
              <span className="truncate text-[11px] text-muted-foreground">
                {email}
              </span>
            </div>
          </div>

          <LanguageToggle className="ml-auto group-data-[collapsible=icon]:order-2 group-data-[collapsible=icon]:ml-0" />

          <ThemeToggle className="group-data-[collapsible=icon]:order-3" />

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 border-0 group-data-[collapsible=icon]:order-4"
            aria-label={t("sidebar.user.logOut")}
            title={t("sidebar.user.logOut")}
          >
            <LogOutIcon />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t("sidebar.user.openMenu")}
              title={t("sidebar.user.openMenu")}
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 border-0 group-data-[collapsible=icon]:order-1"
                />
              }
            >
              <ChevronsUpDownIcon className="group-data-[collapsible=icon]:hidden" />
              <span className="hidden size-8 group-data-[collapsible=icon]:block">
                <UserAvatar label={initials} />
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="min-w-56 rounded-lg"
              side={isMobile ? "bottom" : "right"}
              align="end"
              sideOffset={4}
            >
              <DropdownMenuGroup>
                <DropdownMenuItem
                  className={menuItemClassName}
                  onClick={() => setSettingsOpen(true)}
                >
                  <SettingsIcon className="size-3.5" />
                  {t("sidebar.user.settings")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem className={menuItemClassName}>
                  <BookOpenTextIcon className="size-3.5" />
                  {t("sidebar.user.apiDocumentation")}
                </DropdownMenuItem>
                <DropdownMenuItem className={menuItemClassName}>
                  <InfoIcon className="size-3.5" />
                  {t("sidebar.user.about")}
                </DropdownMenuItem>
                <DropdownMenuItem className={menuItemClassName}>
                  <MonitorCogIcon className="size-3.5" />
                  {t("sidebar.user.systemInformation")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem className={menuItemClassName}>
                  <MessageSquareTextIcon className="size-3.5" />
                  {t("sidebar.user.feedback")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  )
}
