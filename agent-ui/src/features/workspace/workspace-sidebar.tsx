"use client"

import * as React from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import {
  Sidebar,
  SidebarContent,
} from "@/components/ui/sidebar"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

import { WorkspaceHome } from "./workspace-home"
import { useWorkspaceFiles } from "./workspace-files-context"
import { WorkspaceTabs } from "./workspace-tabs"
import { WorkspaceToggle } from "./workspace-toggle"

export function WorkspaceSidebar({
  className,
  onContentMinimumWidthChange,
  onMinimumWidthChange,
  resizable = true,
  style,
}: {
  className?: string
  onContentMinimumWidthChange?: (width: number) => void
  onMinimumWidthChange?: (width: number) => void
  resizable?: boolean
  style?: React.CSSProperties
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const { activeTabId, setActiveTabId } = useWorkspaceFiles()
  const contentRef = React.useRef<HTMLDivElement>(null)

  const tabMode = activeTabId !== null
  const motionTransition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.2, ease: EASE_OUT }
  const handleTabMinimumWidthChange = React.useCallback(
    (tabWidth: number) => {
      const content = contentRef.current

      if (!content || !onMinimumWidthChange) {
        return
      }

      const contentStyles = getComputedStyle(content)
      const sidebar = content.closest<HTMLElement>(
        '[data-slot="sidebar-container"]'
      )
      const sidebarStyles = sidebar ? getComputedStyle(sidebar) : null
      const horizontalChrome =
        (Number.parseFloat(contentStyles.paddingInlineStart) || 0) +
        (Number.parseFloat(contentStyles.paddingInlineEnd) || 0) +
        (Number.parseFloat(sidebarStyles?.borderInlineStartWidth ?? "") || 0) +
        (Number.parseFloat(sidebarStyles?.borderInlineEndWidth ?? "") || 0)

      onMinimumWidthChange(Math.ceil(tabWidth + horizontalChrome))
    },
    [onMinimumWidthChange]
  )
  const handleFileBrowserMinimumWidthChange = React.useCallback(
    (fileBrowserWidth: number) => {
      const content = contentRef.current
      const fileBrowser = content?.querySelector<HTMLElement>(
        "[data-file-browser-enter]"
      )
      const sidebar = content?.closest<HTMLElement>(
        '[data-slot="sidebar-container"]'
      )

      if (
        activeTabId !== "files" ||
        !fileBrowser ||
        !sidebar ||
        !onContentMinimumWidthChange
      ) {
        return
      }

      const horizontalChrome = Math.max(
        0,
        sidebar.getBoundingClientRect().width -
          fileBrowser.getBoundingClientRect().width
      )

      onContentMinimumWidthChange(
        Math.ceil(fileBrowserWidth + horizontalChrome)
      )
    },
    [activeTabId, onContentMinimumWidthChange]
  )

  React.useLayoutEffect(() => {
    if (activeTabId !== "files") {
      onContentMinimumWidthChange?.(0)
    }
  }, [activeTabId, onContentMinimumWidthChange])

  return (
    <Sidebar
      id="workspace-sidebar"
      side="right"
      role="complementary"
      aria-label={t("workspace.label")}
      className={cn(
        "bg-workspace-panel [&_[data-slot=sidebar-inner]]:bg-workspace-panel!",
        className
      )}
      style={style}
      resizable={resizable}
      resizeLabel={t("workspace.resize")}
      mobileTitle={t("workspace.label")}
      mobileDescription={t("workspace.description")}
    >
      <WorkspaceToggle className="absolute top-1 right-4 z-20 md:hidden" />
      <SidebarContent
        ref={contentRef}
        className={
          tabMode
            ? "min-h-0 overflow-hidden px-1.5 pt-1 pb-2"
            : "items-start justify-center"
        }
      >
        <AnimatePresence initial={false} mode="wait">
          {tabMode && activeTabId ? (
            <motion.div
              key="tabs"
              className="flex min-h-0 min-w-0 flex-1 flex-col"
              initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={
                shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }
              }
              transition={motionTransition}
            >
              <WorkspaceTabs
                activeId={activeTabId}
                onActiveIdChange={setActiveTabId}
                onFileBrowserMinimumWidthChange={
                  handleFileBrowserMinimumWidthChange
                }
                onMinimumWidthChange={handleTabMinimumWidthChange}
              />
            </motion.div>
          ) : (
            <motion.div
              key="home"
              className="flex w-full flex-col items-start"
              initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={
                shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }
              }
              transition={motionTransition}
            >
              <WorkspaceHome onAction={setActiveTabId} />
            </motion.div>
          )}
        </AnimatePresence>
      </SidebarContent>
    </Sidebar>
  )
}
