import * as React from "react"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import gsap from "gsap"
import { PanelLeftIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { SidebarMenuHighlight } from "@/components/motion/sidebar-menu-highlight"

const SIDEBAR_COOKIE_NAME = "sidebar_state"
const SIDEBAR_WIDTH_COOKIE_NAME = "sidebar_width"
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SIDEBAR_DEFAULT_WIDTH = 300
const SIDEBAR_COLLAPSE_THRESHOLD = 180
const SIDEBAR_MAX_WIDTH = 384
const SIDEBAR_RESIZE_STEP = 8
const SIDEBAR_WIDTH_MOBILE = "18rem"
const SIDEBAR_WIDTH_ICON = "3rem"
const SIDEBAR_KEYBOARD_SHORTCUT = "b"

function clampSidebarWidth(
  width: number,
  maxWidth = SIDEBAR_MAX_WIDTH
) {
  return Math.min(
    Math.max(0, Math.floor(maxWidth)),
    Math.max(0, Math.round(width))
  )
}

function isCookieAccessError(error: unknown) {
  return error instanceof DOMException && error.name === "SecurityError"
}

function getInitialSidebarWidth(
  defaultWidth: number,
  maxWidth: number,
  widthCookieName: string | false
) {
  const fallbackWidth = clampSidebarWidth(defaultWidth, maxWidth)

  if (typeof document === "undefined" || !widthCookieName) {
    return fallbackWidth
  }

  try {
    const widthCookie = document.cookie
      .split("; ")
      .find((cookie) => cookie.startsWith(`${widthCookieName}=`))
    const storedWidth = Number(widthCookie?.split("=")[1])

    return Number.isFinite(storedWidth) &&
      storedWidth >= SIDEBAR_COLLAPSE_THRESHOLD
      ? clampSidebarWidth(storedWidth, maxWidth)
      : fallbackWidth
  } catch (error) {
    if (isCookieAccessError(error)) {
      return fallbackWidth
    }

    throw error
  }
}

function persistSidebarWidth(
  width: number,
  widthCookieName: string | false
) {
  if (typeof document === "undefined" || !widthCookieName) {
    return
  }

  try {
    document.cookie = `${widthCookieName}=${width}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; SameSite=Lax`
  } catch (error) {
    if (!isCookieAccessError(error)) {
      throw error
    }
  }
}

function persistSidebarState(
  open: boolean,
  stateCookieName: string | false
) {
  if (typeof document === "undefined" || !stateCookieName) {
    return
  }

  try {
    document.cookie = `${stateCookieName}=${open}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; SameSite=Lax`
  } catch (error) {
    if (!isCookieAccessError(error)) {
      throw error
    }
  }
}

type SidebarContextProps = {
  state: "expanded" | "collapsed"
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
  sidebarWidth: number
  maxSidebarWidth: number
  commitSidebarWidth: (width: number) => void
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }

  return context
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  keyboardShortcut = SIDEBAR_KEYBOARD_SHORTCUT,
  defaultWidth = SIDEBAR_DEFAULT_WIDTH,
  maxWidth = SIDEBAR_MAX_WIDTH,
  widthCookieName = SIDEBAR_WIDTH_COOKIE_NAME,
  stateCookieName = SIDEBAR_COOKIE_NAME,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  keyboardShortcut?: string | false
  defaultWidth?: number
  maxWidth?: number
  widthCookieName?: string | false
  stateCookieName?: string | false
}) {
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = React.useState(false)
  const maxSidebarWidth = Math.max(0, Math.floor(maxWidth))
  const [preferredSidebarWidth, setPreferredSidebarWidth] = React.useState(
    () =>
      getInitialSidebarWidth(
        defaultWidth,
        maxSidebarWidth,
        widthCookieName
      )
  )
  const sidebarWidth = clampSidebarWidth(
    preferredSidebarWidth,
    maxSidebarWidth
  )

  // This is the internal state of the sidebar.
  // We use openProp and setOpenProp for control from outside the component.
  const [_open, _setOpen] = React.useState(defaultOpen)
  const open = openProp ?? _open
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        _setOpen(openState)
      }

      persistSidebarState(openState, stateCookieName)
    },
    [setOpenProp, open, stateCookieName]
  )

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open)
  }, [isMobile, setOpen, setOpenMobile])

  const commitSidebarWidth = React.useCallback((width: number) => {
    const nextWidth = clampSidebarWidth(width, maxSidebarWidth)

    if (nextWidth < SIDEBAR_COLLAPSE_THRESHOLD) {
      return
    }

    setPreferredSidebarWidth(nextWidth)
    persistSidebarWidth(nextWidth, widthCookieName)
  }, [maxSidebarWidth, widthCookieName])

  // Adds a keyboard shortcut to toggle the sidebar.
  React.useEffect(() => {
    if (!keyboardShortcut) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === keyboardShortcut &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault()
        toggleSidebar()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [keyboardShortcut, toggleSidebar])

  // We add a state so that we can do data-state="expanded" or "collapsed".
  // This makes it easier to style the sidebar with Tailwind classes.
  const state = open ? "expanded" : "collapsed"

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
      sidebarWidth,
      maxSidebarWidth,
      commitSidebarWidth,
    }),
    [
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
      sidebarWidth,
      maxSidebarWidth,
      commitSidebarWidth,
    ]
  )

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        style={
          {
            "--sidebar-width": `${sidebarWidth}px`,
            "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
            ...style,
          } as React.CSSProperties
        }
        className={cn(
          "group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  className,
  children,
  dir,
  resizable = false,
  resizeLabel,
  mobileTitle,
  mobileDescription,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "left" | "right"
  variant?: "sidebar" | "floating" | "inset"
  collapsible?: "offcanvas" | "icon" | "none"
  resizable?: boolean
  resizeLabel?: string
  mobileTitle?: React.ReactNode
  mobileDescription?: React.ReactNode
}) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar()
  const { t } = useTranslation()

  if (collapsible === "none") {
    return (
      <SidebarMenuHighlight
        data-slot="sidebar"
        className={cn(
          "flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground",
          className
        )}
        {...props}
      >
        {children}
      </SidebarMenuHighlight>
    )
  }

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
        <SheetContent
          dir={dir}
          data-sidebar="sidebar"
          data-slot="sidebar"
          data-mobile="true"
          className="w-(--sidebar-width) bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
            } as React.CSSProperties
          }
          side={side}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{mobileTitle ?? t("common.sidebar")}</SheetTitle>
            <SheetDescription>
              {mobileDescription ?? t("common.sidebarDescription")}
            </SheetDescription>
          </SheetHeader>
          <SidebarMenuHighlight className="flex h-full w-full flex-col">
            {children}
          </SidebarMenuHighlight>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div
      className="group peer hidden text-sidebar-foreground md:block"
      data-state={state}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-variant={variant}
      data-side={side}
      data-slot="sidebar"
    >
      {/* This is what handles the sidebar gap on desktop */}
      <div
        data-slot="sidebar-gap"
        className={cn(
          "relative w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-linear group-data-[resizing=true]/sidebar-wrapper:transition-none",
          "group-data-[collapsible=offcanvas]:w-0",
          "group-data-[side=right]:rotate-180",
          variant === "floating" || variant === "inset"
            ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]"
            : "group-data-[collapsible=icon]:w-(--sidebar-width-icon)"
        )}
      />
      <div
        data-slot="sidebar-container"
        data-side={side}
        className={cn(
          "fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) transition-[left,right,width] duration-200 ease-linear group-data-[resizing=true]/sidebar-wrapper:transition-none data-[side=left]:left-0 data-[side=left]:group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)] data-[side=right]:right-0 data-[side=right]:group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)] md:flex",
          // Adjust the padding for floating and inset variants.
          variant === "floating" || variant === "inset"
            ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]"
            : "group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l",
          className
        )}
        {...props}
      >
        <SidebarMenuHighlight
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className="flex size-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:shadow-sm group-data-[variant=floating]:ring-1 group-data-[variant=floating]:ring-sidebar-border"
        >
          {children}
        </SidebarMenuHighlight>
        {resizable && (
          <SidebarResizeHandle side={side} label={resizeLabel} />
        )}
      </div>
    </div>
  )
}

function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar()
  const { t } = useTranslation()

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon-sm"
      className={cn(className)}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      <PanelLeftIcon />
      <span className="sr-only">{t("common.toggleSidebar")}</span>
    </Button>
  )
}

function SidebarResizeHandle({
  side,
  label,
}: {
  side: "left" | "right"
  label?: string
}) {
  const {
    sidebarWidth,
    maxSidebarWidth,
    commitSidebarWidth,
    setOpen,
  } = useSidebar()
  const { t } = useTranslation()
  const handleRef = React.useRef<HTMLDivElement>(null)
  const indicatorRef = React.useRef<HTMLSpanElement>(null)
  const activePointerIdRef = React.useRef<number | null>(null)
  const activeWidthRef = React.useRef(sidebarWidth)
  const previousBodyStyleRef = React.useRef<{
    cursor: string
    userSelect: string
  } | null>(null)
  const indicatorTweensRef = React.useRef<{
    scaleX: (value: number) => void
    scaleY: (value: number) => void
  } | null>(null)
  const [displayedWidth, setDisplayedWidth] = React.useState(sidebarWidth)
  const [isDragging, setIsDragging] = React.useState(false)

  React.useEffect(() => {
    activeWidthRef.current = sidebarWidth
    setDisplayedWidth(sidebarWidth)
  }, [sidebarWidth])

  React.useLayoutEffect(() => {
    const handle = handleRef.current
    const indicator = indicatorRef.current

    if (
      !handle ||
      !indicator ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return
    }

    const context = gsap.context(() => {
      const scaleX = gsap.quickTo(indicator, "scaleX", {
        duration: 0.16,
        ease: "power2.out",
      })
      const scaleY = gsap.quickTo(indicator, "scaleY", {
        duration: 0.16,
        ease: "power2.out",
      })

      indicatorTweensRef.current = {
        scaleX: (value) => void scaleX(value),
        scaleY: (value) => void scaleY(value),
      }
    }, handle)

    return () => {
      indicatorTweensRef.current = null
      context.revert()
    }
  }, [])

  const restoreBodyInteraction = React.useCallback(() => {
    handleRef.current
      ?.closest('[data-slot="sidebar-wrapper"]')
      ?.removeAttribute("data-resizing")

    const previousBodyStyle = previousBodyStyleRef.current

    if (!previousBodyStyle) {
      return
    }

    document.body.style.cursor = previousBodyStyle.cursor
    document.body.style.userSelect = previousBodyStyle.userSelect
    previousBodyStyleRef.current = null
  }, [])

  React.useEffect(
    () => () => {
      restoreBodyInteraction()
    },
    [restoreBodyInteraction]
  )

  const setHandleActive = React.useCallback((active: boolean) => {
    setIsDragging(active)
    indicatorTweensRef.current?.scaleX(active ? 2 : 1)
    indicatorTweensRef.current?.scaleY(active ? 1.04 : 1)
  }, [])

  const applySidebarWidth = React.useCallback(
    (width: number) => {
      const nextWidth = clampSidebarWidth(width, maxSidebarWidth)
      const wrapper = handleRef.current?.closest(
        '[data-slot="sidebar-wrapper"]'
      ) as HTMLElement | null

      activeWidthRef.current = nextWidth
      setDisplayedWidth(nextWidth)
      wrapper?.style.setProperty("--sidebar-width", `${nextWidth}px`)
    },
    [maxSidebarWidth]
  )

  const getWidthFromPointer = React.useCallback(
    (clientX: number) =>
      clampSidebarWidth(
        side === "left" ? clientX : window.innerWidth - clientX,
        maxSidebarWidth
      ),
    [maxSidebarWidth, side]
  )

  const endResize = React.useCallback(
    (shouldCommit: boolean) => {
      if (activePointerIdRef.current === null) {
        return
      }

      activePointerIdRef.current = null

      if (shouldCommit) {
        commitSidebarWidth(activeWidthRef.current)
      }

      restoreBodyInteraction()
      setHandleActive(false)
    },
    [commitSidebarWidth, restoreBodyInteraction, setHandleActive]
  )

  const finishResize = React.useCallback(() => {
    endResize(true)
  }, [endResize])

  const collapseSidebarFromResize = React.useCallback(() => {
    applySidebarWidth(sidebarWidth)
    endResize(false)
    setOpen(false)
  }, [applySidebarWidth, endResize, setOpen, sidebarWidth])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      let nextWidth: number | undefined

      if (event.key === "Home") {
        nextWidth = 0
      } else if (event.key === "End") {
        nextWidth = maxSidebarWidth
      } else if (event.key === "ArrowLeft") {
        nextWidth =
          activeWidthRef.current +
          (side === "left" ? -SIDEBAR_RESIZE_STEP : SIDEBAR_RESIZE_STEP)
      } else if (event.key === "ArrowRight") {
        nextWidth =
          activeWidthRef.current +
          (side === "left" ? SIDEBAR_RESIZE_STEP : -SIDEBAR_RESIZE_STEP)
      }

      if (nextWidth === undefined) {
        return
      }

      event.preventDefault()

      if (nextWidth < SIDEBAR_COLLAPSE_THRESHOLD) {
        collapseSidebarFromResize()
        return
      }

      applySidebarWidth(nextWidth)
      commitSidebarWidth(nextWidth)
    },
    [
      applySidebarWidth,
      collapseSidebarFromResize,
      commitSidebarWidth,
      maxSidebarWidth,
      side,
    ]
  )

  return (
    <div
      ref={handleRef}
      role="separator"
      aria-label={label ?? t("common.resizeSidebar")}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={maxSidebarWidth}
      aria-valuenow={displayedWidth}
      tabIndex={0}
      title={label ?? t("common.resizeSidebar")}
      data-slot="sidebar-resize-handle"
      data-side={side}
      data-dragging={isDragging}
      className="group/resize absolute inset-y-0 z-30 hidden w-3 touch-none cursor-col-resize items-center justify-center outline-none data-[side=left]:-right-1.5 data-[side=right]:-left-1.5 group-data-[collapsible=icon]:hidden group-data-[collapsible=offcanvas]:hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring md:flex"
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return
        }

        event.preventDefault()
        activePointerIdRef.current = event.pointerId
        event.currentTarget.setPointerCapture(event.pointerId)
        event.currentTarget
          .closest('[data-slot="sidebar-wrapper"]')
          ?.setAttribute("data-resizing", "true")
        previousBodyStyleRef.current = {
          cursor: document.body.style.cursor,
          userSelect: document.body.style.userSelect,
        }
        document.body.style.cursor = "col-resize"
        document.body.style.userSelect = "none"
        setHandleActive(true)
      }}
      onPointerMove={(event) => {
        if (activePointerIdRef.current !== event.pointerId) {
          return
        }

        const nextWidth = getWidthFromPointer(event.clientX)

        if (nextWidth < SIDEBAR_COLLAPSE_THRESHOLD) {
          collapseSidebarFromResize()
          return
        }

        applySidebarWidth(nextWidth)
      }}
      onPointerUp={(event) => {
        if (activePointerIdRef.current !== event.pointerId) {
          return
        }

        const nextWidth = getWidthFromPointer(event.clientX)

        if (nextWidth < SIDEBAR_COLLAPSE_THRESHOLD) {
          collapseSidebarFromResize()
          return
        }

        applySidebarWidth(nextWidth)
        finishResize()
      }}
      onPointerCancel={finishResize}
      onLostPointerCapture={finishResize}
    >
      <span
        ref={indicatorRef}
        className={cn(
          "h-full w-px origin-center bg-sidebar-border/70 transition-colors group-hover/resize:bg-sidebar-ring group-focus-visible/resize:bg-sidebar-ring",
          isDragging && "bg-sidebar-ring"
        )}
      />
    </div>
  )
}

function SidebarRail({ className, ...props }: React.ComponentProps<"button">) {
  const { toggleSidebar } = useSidebar()
  const { t } = useTranslation()

  return (
    <button
      data-sidebar="rail"
      data-slot="sidebar-rail"
      aria-label={t("common.toggleSidebar")}
      tabIndex={-1}
      onClick={toggleSidebar}
      title={t("common.toggleSidebar")}
      className={cn(
        "absolute inset-y-0 z-20 hidden w-4 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:start-1/2 after:w-[2px] hover:after:bg-sidebar-border sm:flex ltr:-translate-x-1/2 rtl:-translate-x-1/2",
        "in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize",
        "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
        "group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full hover:group-data-[collapsible=offcanvas]:bg-sidebar",
        "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
        "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
        className
      )}
      {...props}
    />
  )
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        "relative flex w-full flex-1 flex-col bg-background md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2",
        className
      )}
      {...props}
    />
  )
}

function SidebarInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <Input
      data-slot="sidebar-input"
      data-sidebar="input"
      className={cn("h-8 w-full bg-background shadow-none", className)}
      {...props}
    />
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  )
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  )
}

function SidebarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="sidebar-separator"
      data-sidebar="separator"
      className={cn("mx-2 w-auto bg-sidebar-border", className)}
      {...props}
    />
  )
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        "no-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
      {...props}
    />
  )
}

function SidebarGroupLabel({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div"> & React.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          "flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 ring-sidebar-ring outline-hidden transition-[margin,opacity] duration-200 ease-linear group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0 focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
          className
        ),
      },
      props
    ),
    render,
    state: {
      slot: "sidebar-group-label",
      sidebar: "group-label",
    },
  })
}

function SidebarGroupAction({
  className,
  render,
  ...props
}: useRender.ComponentProps<"button"> & React.ComponentProps<"button">) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        className: cn(
          "absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden transition-transform group-data-[collapsible=icon]:hidden after:absolute after:-inset-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 md:after:hidden [&>svg]:size-4 [&>svg]:shrink-0",
          className
        ),
      },
      props
    ),
    render,
    state: {
      slot: "sidebar-group-action",
      sidebar: "group-action",
    },
  })
}

function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn("w-full text-sm", className)}
      {...props}
    />
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn("flex w-full min-w-0 flex-col gap-1", className)}
      {...props}
    />
  )
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn("group/menu-item relative", className)}
      {...props}
    />
  )
}

const sidebarMenuButtonVariants = cva(
  "peer/menu-button group/menu-button relative z-[1] flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm ring-sidebar-ring outline-hidden transition-[width,height,padding,color] group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-open:hover:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&>span:last-child]:truncate",
  {
    variants: {
      variant: {
        default: "hover:text-sidebar-accent-foreground",
        outline:
          "bg-background shadow-[0_0_0_1px_var(--sidebar-border)] hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_var(--sidebar-accent)]",
      },
      size: {
        default: "h-8 text-sm",
        sm: "h-7 text-xs",
        lg: "h-12 text-sm group-data-[collapsible=icon]:p-0!",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function SidebarMenuButton({
  render,
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  className,
  ...props
}: useRender.ComponentProps<"button"> &
  React.ComponentProps<"button"> & {
    isActive?: boolean
    tooltip?: string | React.ComponentProps<typeof TooltipContent>
  } & VariantProps<typeof sidebarMenuButtonVariants>) {
  const { isMobile, state } = useSidebar()
  const comp = useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        className: cn(sidebarMenuButtonVariants({ variant, size }), className),
      },
      props
    ),
    render: !tooltip ? render : <TooltipTrigger render={render} />,
    state: {
      slot: "sidebar-menu-button",
      sidebar: "menu-button",
      size,
      active: isActive,
    },
  })

  if (!tooltip) {
    return comp
  }

  if (typeof tooltip === "string") {
    tooltip = {
      children: tooltip,
    }
  }

  return (
    <Tooltip>
      {comp}
      <TooltipContent
        side="right"
        align="center"
        hidden={state !== "collapsed" || isMobile}
        {...tooltip}
      />
    </Tooltip>
  )
}

function SidebarMenuAction({
  className,
  render,
  showOnHover = false,
  ...props
}: useRender.ComponentProps<"button"> &
  React.ComponentProps<"button"> & {
    showOnHover?: boolean
  }) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        className: cn(
          "absolute top-1.5 right-1 z-[2] flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden transition-transform group-data-[collapsible=icon]:hidden peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1 after:absolute after:-inset-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 md:after:hidden [&>svg]:size-4 [&>svg]:shrink-0",
          showOnHover &&
            "group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 peer-data-active/menu-button:text-sidebar-accent-foreground aria-expanded:opacity-100 md:opacity-0",
          className
        ),
      },
      props
    ),
    render,
    state: {
      slot: "sidebar-menu-action",
      sidebar: "menu-action",
    },
  })
}

function SidebarMenuBadge({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      className={cn(
        "pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium text-sidebar-foreground tabular-nums select-none group-data-[collapsible=icon]:hidden peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1 peer-data-active/menu-button:text-sidebar-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSkeleton({
  className,
  showIcon = false,
  ...props
}: React.ComponentProps<"div"> & {
  showIcon?: boolean
}) {
  // Random width between 50 to 90%.
  const [width] = React.useState(() => {
    return `${Math.floor(Math.random() * 40) + 50}%`
  })

  return (
    <div
      data-slot="sidebar-menu-skeleton"
      data-sidebar="menu-skeleton"
      className={cn("flex h-8 items-center gap-2 rounded-md px-2", className)}
      {...props}
    >
      {showIcon && (
        <Skeleton
          className="size-4 rounded-md"
          data-sidebar="menu-skeleton-icon"
        />
      )}
      <Skeleton
        className="h-4 max-w-(--skeleton-width) flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          {
            "--skeleton-width": width,
          } as React.CSSProperties
        }
      />
    </div>
  )
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      data-sidebar="menu-sub"
      className={cn(
        "mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5 group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSubItem({
  className,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-sub-item"
      data-sidebar="menu-sub-item"
      className={cn("group/menu-sub-item relative", className)}
      {...props}
    />
  )
}

function SidebarMenuSubButton({
  render,
  size = "md",
  isActive = false,
  className,
  ...props
}: useRender.ComponentProps<"a"> &
  React.ComponentProps<"a"> & {
    size?: "sm" | "md"
    isActive?: boolean
  }) {
  return useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(
      {
        className: cn(
          "relative z-[1] flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sidebar-foreground ring-sidebar-ring outline-hidden transition-colors group-data-[collapsible=icon]:hidden hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[size=md]:text-sm data-[size=sm]:text-xs data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground",
          className
        ),
      },
      props
    ),
    render,
    state: {
      slot: "sidebar-menu-sub-button",
      sidebar: "menu-sub-button",
      size,
      active: isActive,
    },
  })
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
}
