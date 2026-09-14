"use client"

import * as React from "react"
import gsap from "gsap"
import { BotIcon, CheckIcon } from "lucide-react"
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
import { useHarness } from "./harness-context"
import { HarnessRuntimeLabel } from "./harness-runtime-label"
import { useHarnessDefaultWidth } from "./use-harness-default-width"
import {
  getHarnessOption,
  harnessOptions,
  isSelectableHarnessId,
  type HarnessId,
} from "./harness-options"
import { TooltipHint } from "@/components/ui/tooltip"

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
      <DropdownMenuGroup className="flex flex-col gap-2">
        <DropdownMenuLabel className="text-xs font-normal">
          {t("sidebar.harness.select")}
        </DropdownMenuLabel>
        {harnessOptions.map((option) => {
          const isActive = option.id === activeHarnessId

          return (
            <DropdownMenuItem
              key={option.id}
              data-harness-option
              disabled={option.disabled}
              className="p-0 [&_[data-slot=item-description]]:text-muted-foreground focus:[&_[data-slot=item-description]]:text-muted-foreground"
              onClick={() => {
                if (isSelectableHarnessId(option.id)) {
                  onSelect(option.id)
                }
              }}
            >
              <Item
                size="xs"
                variant={isActive ? "muted" : "default"}
                className="w-full flex-nowrap items-center gap-3 py-2 in-data-[slot=dropdown-menu-content]:px-3 in-data-[slot=dropdown-menu-content]:py-2"
              >
                <ItemMedia className="size-8 self-center translate-y-0">
                  <HarnessBrandLogo harnessId={option.id} />
                </ItemMedia>
                <ItemContent className="min-w-0 gap-0.5">
                  <ItemTitle className="text-sm">
                    <span className="truncate">{t(option.nameKey)}</span>
                    {option.disabled ? (
                      <Badge
                        variant="secondary"
                        className="h-4 px-1.5 text-[11px]"
                      >
                        {t("sidebar.harness.comingSoon")}
                      </Badge>
                    ) : null}
                  </ItemTitle>
                  <ItemDescription className="text-xs leading-snug whitespace-normal">
                    {t(option.descriptionKey)}
                  </ItemDescription>
                </ItemContent>
                {isActive ? (
                  <ItemActions>
                    <CheckIcon className="size-3.5" />
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
  const { rowRef, measurementRef } = useHarnessDefaultWidth()
  const { isMobile, setOpen, state } = useSidebar()
  const { t } = useTranslation()
  const { harnessId: activeHarnessId, setHarnessId: setActiveHarnessId } =
    useHarness()
  const [harnessMenuOpen, setHarnessMenuOpen] = React.useState(false)
  const activeHarness = getHarnessOption(activeHarnessId)
  const isCollapsed = !isMobile && state === "collapsed"
  const runtimeName = t(activeHarness.nameKey)

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
  }, [])

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
            <TooltipHint content={
                isCollapsed
                  ? t("common.expandSidebar")
                  : runtimeName
              }>
              <DropdownMenuTrigger
                aria-label={
                  isCollapsed
                    ? t("common.expandSidebar")
                    : `${t("sidebar.harness.select")}: ${runtimeName}`
                }
                render={
                  <SidebarMenuButton
                    size="lg"
                    className="h-auto min-h-12 data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground [&_[data-brand-logo]_svg]:size-6 [&_[data-runtime-logo]_svg]:size-3.5"
                  />
                }
              >
                <div
                  ref={logoRef}
                  data-brand-logo
                  className="flex size-8 items-center justify-center"
                >
                  <BotIcon aria-hidden="true" />
                </div>
                <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="min-w-0 truncate text-lg font-bold">
                      {t("sidebar.brand")}
                    </span>
                    <span className="shrink-0 text-xs font-normal text-muted-foreground/60">
                      {t("sidebar.beta")}
                    </span>
                  </span>
                  <span ref={rowRef} className="relative flex min-w-0 items-center gap-1 text-xs text-muted-foreground/60">
                    <span aria-hidden="true" className="pointer-events-none invisible absolute inset-0 overflow-hidden">
                      <span ref={measurementRef} className="inline-grid w-max whitespace-nowrap">
                        {harnessOptions.filter((option) => !option.disabled).map((option) => (
                          <span key={option.id} className="inline-flex items-center gap-1">
                            <span>{t("sidebar.harness.poweredBy")}</span>
                            <HarnessBrandLogo
                              harnessId={option.id}
                              className={option.id === "pi" ? "size-3 shrink-0" : "size-3.5 shrink-0"}
                            />
                            <span>{t(option.nameKey)}</span>
                          </span>
                        ))}
                      </span>
                    </span>
                    <span className="shrink-0">{t("sidebar.harness.poweredBy")}</span>
                    <HarnessRuntimeLabel harnessId={activeHarnessId} name={runtimeName} />
                  </span>
                </div>
              </DropdownMenuTrigger>
            </TooltipHint>
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
      <TooltipHint content={t("common.collapseSidebar")}>
        <SidebarTrigger
          className="shrink-0 group-data-[collapsible=icon]:hidden"
          aria-label={t("common.collapseSidebar")}
        />
      </TooltipHint>
    </div>
  )
}
