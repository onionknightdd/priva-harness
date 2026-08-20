"use client"

import * as React from "react"

import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"

import { WorkspaceSidebar } from "./workspace-sidebar"
import { WorkspaceToggle } from "./workspace-toggle"

const WORKSPACE_DEFAULT_WIDTH = 256
const WORKSPACE_MAX_VIEWPORT_RATIO = 0.75
const WORKSPACE_MIN_CONTENT_RATIO = 0.2

type WorkspaceLayout = {
  viewportWidth: number
  leftSidebarBoundary: number
}

function getInitialWorkspaceLayout(): WorkspaceLayout {
  return {
    viewportWidth:
      typeof window === "undefined" ? 0 : window.innerWidth,
    leftSidebarBoundary: 0,
  }
}

export function WorkspaceShell({
  children,
  workspaceEnabled = true,
}: {
  children: React.ReactNode
  workspaceEnabled?: boolean
}) {
  const shellRef = React.useRef<HTMLDivElement>(null)
  const [layout, setLayout] = React.useState(getInitialWorkspaceLayout)

  React.useLayoutEffect(() => {
    if (!workspaceEnabled) {
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
  }, [workspaceEnabled])

  const workspaceMaxWidth = Math.max(
    0,
    Math.floor(
      Math.min(
        layout.viewportWidth * WORKSPACE_MAX_VIEWPORT_RATIO,
        layout.viewportWidth -
          layout.leftSidebarBoundary -
          layout.viewportWidth * WORKSPACE_MIN_CONTENT_RATIO
      )
    )
  )

  return (
    <SidebarProvider
      ref={shellRef}
      className="h-full min-h-0 overflow-hidden"
      keyboardShortcut={false}
      defaultWidth={WORKSPACE_DEFAULT_WIDTH}
      maxWidth={workspaceMaxWidth}
      widthCookieName="workspace_width"
      stateCookieName="workspace_state"
    >
      <SidebarInset className="min-h-0 overflow-hidden">
        {children}
      </SidebarInset>
      {workspaceEnabled && (
        <>
          <WorkspaceToggle
            hideWhenMobileOpen
            className="fixed top-1 right-4 z-40"
          />
          <WorkspaceSidebar />
        </>
      )}
    </SidebarProvider>
  )
}
