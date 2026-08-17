"use client"

import * as React from "react"

import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"

import { CanvasSidebar } from "./canvas-sidebar"
import { CanvasToggle } from "./canvas-toggle"

const CANVAS_DEFAULT_WIDTH = 256
const CANVAS_MAX_VIEWPORT_RATIO = 0.75
const CANVAS_MIN_WORKSPACE_RATIO = 0.2

type CanvasLayout = {
  viewportWidth: number
  leftSidebarBoundary: number
}

function getInitialCanvasLayout(): CanvasLayout {
  return {
    viewportWidth:
      typeof window === "undefined" ? 0 : window.innerWidth,
    leftSidebarBoundary: 0,
  }
}

export function CanvasShell({
  children,
  canvasEnabled = true,
}: {
  children: React.ReactNode
  canvasEnabled?: boolean
}) {
  const shellRef = React.useRef<HTMLDivElement>(null)
  const [layout, setLayout] = React.useState(getInitialCanvasLayout)

  React.useLayoutEffect(() => {
    if (!canvasEnabled) {
      return
    }

    const shell = shellRef.current

    if (!shell) {
      return
    }

    const updateLayout = () => {
      const nextLayout = {
        viewportWidth: window.innerWidth,
        leftSidebarBoundary: Math.max(
          0,
          Math.round(shell.getBoundingClientRect().left)
        ),
      }

      setLayout((currentLayout) =>
        currentLayout.viewportWidth === nextLayout.viewportWidth &&
        currentLayout.leftSidebarBoundary ===
          nextLayout.leftSidebarBoundary
          ? currentLayout
          : nextLayout
      )
    }

    updateLayout()

    const resizeObserver = new ResizeObserver(updateLayout)
    resizeObserver.observe(shell)
    window.addEventListener("resize", updateLayout)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener("resize", updateLayout)
    }
  }, [canvasEnabled])

  const canvasMaxWidth = Math.max(
    0,
    Math.floor(
      Math.min(
        layout.viewportWidth * CANVAS_MAX_VIEWPORT_RATIO,
        layout.viewportWidth -
          layout.leftSidebarBoundary -
          layout.viewportWidth * CANVAS_MIN_WORKSPACE_RATIO
      )
    )
  )

  return (
    <SidebarProvider
      ref={shellRef}
      className="h-full min-h-0 overflow-hidden"
      keyboardShortcut={false}
      defaultWidth={CANVAS_DEFAULT_WIDTH}
      maxWidth={canvasMaxWidth}
      widthCookieName="canvas_width"
      stateCookieName="canvas_state"
    >
      <SidebarInset className="min-h-0 overflow-hidden">
        {children}
      </SidebarInset>
      {canvasEnabled && (
        <>
          <CanvasToggle
            hideWhenMobileOpen
            className="fixed top-1 right-4 z-40"
          />
          <CanvasSidebar />
        </>
      )}
    </SidebarProvider>
  )
}
