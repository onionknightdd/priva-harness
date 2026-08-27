"use client"

import * as React from "react"
import gsap from "gsap"
import { BotIcon, CheckIcon } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
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
import {
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
                className="w-full flex-nowrap items-center p-2"
              >
                <ItemMedia className="self-center translate-y-0">
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
  const { isMobile, setOpen, state } = useSidebar()
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion() === true
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
            <DropdownMenuTrigger
              aria-label={
                isCollapsed
                  ? t("common.expandSidebar")
                  : t("sidebar.harness.select")
              }
              title={
                isCollapsed
                  ? t("common.expandSidebar")
                  : runtimeName
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
                <span className="truncate text-lg font-bold">
                  {t("sidebar.brand")}
                </span>
                <span className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
                  <AnimatePresence initial={false} mode="wait">
                    <motion.span
                      key={activeHarnessId}
                      data-runtime-logo
                      className="inline-flex min-w-0 items-center gap-1"
                      initial={
                        reduceMotion ? false : { opacity: 0, y: 5 }
                      }
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduceMotion ? undefined : { opacity: 0, y: -5 }}
                      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <HarnessBrandLogo
                        className={
                          activeHarness.id === "pi"
                            ? "size-3 shrink-0"
                            : "size-3.5 shrink-0"
                        }
                        harnessId={activeHarness.id}
                      />
                      <span className="truncate">{runtimeName}</span>
                    </motion.span>
                  </AnimatePresence>
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
