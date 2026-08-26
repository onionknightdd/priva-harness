"use client"

import * as React from "react"

import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"

import { WorkspaceDensityBridge } from "./workspace-density"
import { WorkspaceFilesProvider } from "./workspace-files-context"
import { WorkspaceSidebar } from "./workspace-sidebar"
import { WorkspacePanelButtons } from "./workspace-toggle"

const WORKSPACE_DEFAULT_WIDTH = 256
const WORKSPACE_MAX_VIEWPORT_RATIO = 0.75
const WORKSPACE_MIN_CONTENT_RATIO = 0.2

type WorkspaceLayout = {
  viewportWidth: number
  leftSidebarBoundary: number
  shellWidth: number
}

function getInitialWorkspaceLayout(): WorkspaceLayout {
  return {
    viewportWidth:
      typeof window === "undefined" ? 0 : window.innerWidth,
    leftSidebarBoundary: 0,
    shellWidth: 0,
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
  const [maximized, setMaximized] = React.useState(false)

  React.useLayoutEffect(() => {
    if (!workspaceEnabled) {
      return
    }

    const shell = shellRef.current

    if (!shell) {
      return
    }

    const updateLayout = () => {
      const bounds = shell.getBoundingClientRect()
      const nextLayout = {
        viewportWidth: window.innerWidth,
        leftSidebarBoundary: Math.max(0, Math.round(bounds.left)),
        shellWidth: Math.max(0, Math.round(bounds.width)),
      }

      setLayout((currentLayout) =>
        currentLayout.viewportWidth === nextLayout.viewportWidth &&
        currentLayout.leftSidebarBoundary ===
          nextLayout.leftSidebarBoundary &&
        currentLayout.shellWidth === nextLayout.shellWidth
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

  React.useEffect(() => {
    if (!workspaceEnabled) {
      setMaximized(false)
    }
  }, [workspaceEnabled])

  const maximizedWidth = layout.shellWidth
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
      <WorkspaceFilesProvider>
        <WorkspaceDensityBridge
          maximized={maximized}
          shellWidth={layout.shellWidth}
          workspaceEnabled={workspaceEnabled}
        >
          <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
            {children}
          </SidebarInset>
          {workspaceEnabled && (
            <>
              <WorkspacePanelButtons
                maximized={maximized}
                onMaximizedChange={setMaximized}
              />
              <WorkspaceSidebar
                resizable={!maximized}
                className={maximized ? "z-30" : undefined}
                style={
                  maximized && maximizedWidth > 0
                    ? { width: `${maximizedWidth}px` }
                    : undefined
                }
              />
            </>
          )}
        </WorkspaceDensityBridge>
      </WorkspaceFilesProvider>
    </SidebarProvider>
  )
}
