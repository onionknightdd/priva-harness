import * as React from "react"

import { useSidebar } from "@/components/ui/sidebar"

export function useHarnessDefaultWidth() {
  const rowRef = React.useRef<HTMLSpanElement>(null)
  const measurementRef = React.useRef<HTMLSpanElement>(null)
  const { isMobile, state, sidebarWidth, setDefaultSidebarWidth } = useSidebar()

  React.useLayoutEffect(() => {
    if (isMobile || state === "collapsed") return
    const row = rowRef.current
    const measurement = measurementRef.current
    const sidebar = row?.closest<HTMLElement>('[data-slot="sidebar-container"]')
    const wrapper = sidebar?.closest('[data-slot="sidebar-wrapper"]')
    if (!row || !measurement || !sidebar || !wrapper) return

    const measure = () => {
      if (wrapper.hasAttribute("data-resizing")) return
      const currentWidth = sidebar.getBoundingClientRect().width
      const rowWidth = row.getBoundingClientRect().width
      const requiredWidth = measurement.getBoundingClientRect().width
      // Wait for expansion to finish so collapsed controls do not change the measured chrome.
      if (rowWidth <= 0 || requiredWidth <= 0 || Math.abs(currentWidth - sidebarWidth) > 1) return
      setDefaultSidebarWidth(currentWidth - rowWidth + requiredWidth)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(sidebar)
    observer.observe(row)
    observer.observe(measurement)
    return () => observer.disconnect()
  }, [isMobile, sidebarWidth, state, setDefaultSidebarWidth])

  return { rowRef, measurementRef }
}
