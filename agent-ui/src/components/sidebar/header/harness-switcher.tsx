"use client"

import * as React from "react"
import gsap from "gsap"
import { CheckIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"

import { HarnessBrandLogo } from "./harness-brand-logo"
import {
  DEFAULT_HARNESS_ID,
  getHarnessOption,
  harnessOptions,
  isSelectableHarnessId,
  type HarnessId,
} from "./harness-options"

function HarnessOptionList({
  activeHarnessId,
  onSelect,
  open,
}: {
  activeHarnessId: HarnessId
  onSelect: (id: HarnessId) => void
  open: boolean
}) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const { t } = useTranslation()

  React.useLayoutEffect(() => {
    const list = listRef.current

    if (
      !open ||
      !list ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return
    }

    const items = list.querySelectorAll<HTMLElement>("[data-harness-option]")

    if (items.length === 0) {
      return
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        items,
        { opacity: 0, y: 8 },
        {
          opacity: 1,
          y: 0,
          duration: 0.22,
          stagger: 0.045,
          ease: "power2.out",
          clearProps: "opacity,transform",
        }
      )
    }, list)

    return () => context.revert()
  }, [open])

  return (
    <div ref={listRef}>
      <DropdownMenuGroup className="flex flex-col gap-1">
        <DropdownMenuLabel>{t("sidebar.harness.select")}</DropdownMenuLabel>
        {harnessOptions.map((option) => {
          const isActive = option.id === activeHarnessId

          return (
            <DropdownMenuItem
              key={option.id}
              data-harness-option
              disabled={option.disabled}
              className="p-0"
              onSelect={() => {
                if (isSelectableHarnessId(option.id)) {
                  onSelect(option.id)
                }
              }}
            >
              <Item
                size="sm"
                variant={isActive ? "muted" : "default"}
                className="w-full flex-nowrap p-2.5"
              >
                <ItemMedia>
                  <div className="flex size-8 items-center justify-center overflow-hidden rounded-md bg-background text-foreground ring-1 ring-border">
                    <HarnessBrandLogo harnessId={option.id} />
                  </div>
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle>
                    <span className="truncate">{t(option.nameKey)}</span>
                    {option.disabled ? (
                      <Badge variant="secondary">
                        {t("sidebar.harness.comingSoon")}
                      </Badge>
                    ) : null}
                  </ItemTitle>
                  <ItemDescription className="whitespace-normal">
                    {t(option.descriptionKey)}
                  </ItemDescription>
                </ItemContent>
                {isActive ? (
                  <ItemActions>
                    <CheckIcon />
                  </ItemActions>
                ) : null}
              </Item>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuGroup>
    </div>
  )
}

export function HarnessSwitcher() {
  const logoRef = React.useRef<HTMLDivElement>(null)
  const { isMobile, setOpen, state } = useSidebar()
  const { t } = useTranslation()
  const [activeHarnessId, setActiveHarnessId] =
    React.useState<HarnessId>(DEFAULT_HARNESS_ID)
  const [harnessMenuOpen, setHarnessMenuOpen] = React.useState(false)
  const activeHarness = getHarnessOption(activeHarnessId)
  const isCollapsed = !isMobile && state === "collapsed"

  React.useEffect(() => {
    if (isCollapsed) {
      setHarnessMenuOpen(false)
    }
  }, [isCollapsed])

  React.useLayoutEffect(() => {
    const logo = logoRef.current

    if (
      !logo ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        logo,
        { scale: 0.86, y: 2 },
        {
          scale: 1,
          y: 0,
          duration: 0.22,
          ease: "power2.out",
          clearProps: "transform",
        }
      )
    }, logo)

    return () => context.revert()
  }, [activeHarnessId])

  return (
    <div className="flex items-center gap-1">
      <SidebarMenu className="min-w-0 flex-1">
        <SidebarMenuItem>
          <DropdownMenu
            open={harnessMenuOpen}
            onOpenChange={(open) => {
              if (open && isCollapsed) {
                setOpen(true)
                return
              }
              setHarnessMenuOpen(open)
            }}
          >
            <DropdownMenuTrigger
              aria-label={
                isCollapsed
                  ? t("common.expandSidebar")
                  : t("sidebar.harness.select")
              }
              title={
                isCollapsed
                  ? t("common.expandSidebar")
                  : t("sidebar.harness.select")
              }
              render={
                <SidebarMenuButton
                  size="lg"
                  className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
                />
              }
            >
              <div
                ref={logoRef}
                className="flex aspect-square size-8 items-center justify-center overflow-hidden rounded-lg bg-background text-foreground ring-1 ring-sidebar-border"
              >
                <HarnessBrandLogo harnessId={activeHarness.id} />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">
                  {t(activeHarness.nameKey)}
                </span>
                <span className="truncate text-xs">
                  {t("sidebar.harness.label")}
                </span>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="min-w-72 p-1.5"
            >
              <HarnessOptionList
                activeHarnessId={activeHarnessId}
                open={harnessMenuOpen}
                onSelect={setActiveHarnessId}
              />
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
