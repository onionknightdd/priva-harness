"use client"

import * as React from "react"

import { useSidebar } from "@/components/ui/sidebar"

const WorkspaceDensityContext = React.createContext(false)

export const workspaceDensityTransition = {
  duration: 0.28,
  ease: [0.16, 1, 0.3, 1],
} as const

export function useWorkspaceTakesMajority() {
  return React.useContext(WorkspaceDensityContext)
}

function readLiveSidebarWidth(
  wrapper: HTMLElement,
  fallback: number
) {
  const fromVar = Number.parseFloat(
    getComputedStyle(wrapper).getPropertyValue("--sidebar-width")
  )

  return Number.isFinite(fromVar) && fromVar > 0
    ? Math.round(fromVar)
    : fallback
}

export function WorkspaceDensityBridge({
  children,
  maximized,
  shellWidth,
  workspaceEnabled,
}: {
  children: React.ReactNode
  maximized: boolean
  shellWidth: number
  workspaceEnabled: boolean
}) {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const { isMobile, open, sidebarWidth } = useSidebar()
  const [liveWidth, setLiveWidth] = React.useState(sidebarWidth)

  React.useLayoutEffect(() => {
    setLiveWidth(sidebarWidth)
  }, [sidebarWidth])

  React.useLayoutEffect(() => {
    if (!workspaceEnabled || isMobile) {
      return
    }

    const wrapper = rootRef.current?.closest(
      '[data-slot="sidebar-wrapper"]'
    )

    if (!(wrapper instanceof HTMLElement)) {
      return
    }

    const gap = wrapper.querySelector('[data-slot="sidebar-gap"]')
    const syncWidth = () => {
      setLiveWidth(readLiveSidebarWidth(wrapper, sidebarWidth))
    }

    syncWidth()

    const observer = new ResizeObserver(syncWidth)
    observer.observe(wrapper)

    if (gap instanceof HTMLElement) {
      observer.observe(gap)
    }

    return () => observer.disconnect()
  }, [isMobile, sidebarWidth, workspaceEnabled])

  const takesMajority =
    workspaceEnabled &&
    !isMobile &&
    shellWidth > 0 &&
    (maximized || (open && liveWidth * 5 > shellWidth * 3))

  return (
    <WorkspaceDensityContext.Provider value={takesMajority}>
      <div ref={rootRef} className="contents">
        {children}
      </div>
    </WorkspaceDensityContext.Provider>
  )
}
