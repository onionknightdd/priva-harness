"use client"

import * as React from "react"

import { useSidebar } from "@/components/ui/sidebar"

const WorkspaceDensityContext = React.createContext(false)

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
  const [widthTakesMajority, setWidthTakesMajority] = React.useState(
    () => sidebarWidth * 5 > shellWidth * 3
  )

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
    let previousMajority: boolean | undefined
    const syncWidth = () => {
      const width = readLiveSidebarWidth(wrapper, sidebarWidth)
      const nextMajority = width * 5 > shellWidth * 3
      // Consumers only need this boundary, not every intermediate pixel.
      if (nextMajority !== previousMajority) {
        previousMajority = nextMajority
        setWidthTakesMajority(nextMajority)
      }
    }

    syncWidth()

    const observer = new ResizeObserver(syncWidth)
    observer.observe(wrapper)

    if (gap instanceof HTMLElement) {
      observer.observe(gap)
    }

    return () => observer.disconnect()
  }, [isMobile, shellWidth, sidebarWidth, workspaceEnabled])

  const takesMajority =
    workspaceEnabled &&
    !isMobile &&
    shellWidth > 0 &&
    (maximized || (open && widthTakesMajority))

  return (
    <WorkspaceDensityContext.Provider value={takesMajority}>
      <div ref={rootRef} className="contents">
        {children}
      </div>
    </WorkspaceDensityContext.Provider>
  )
}
