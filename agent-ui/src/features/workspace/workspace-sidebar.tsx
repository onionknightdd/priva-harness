"use client"

import * as React from "react"
import { useTranslation } from "react-i18next"

import {
  Sidebar,
  SidebarContent,
} from "@/components/ui/sidebar"

import { WorkspaceHome } from "./workspace-home"
import { WorkspaceToggle } from "./workspace-toggle"
import { WorkspaceFileView } from "./views/workspace-file-view"

export function WorkspaceSidebar({
  className,
  resizable = true,
  style,
}: {
  className?: string
  resizable?: boolean
  style?: React.CSSProperties
}) {
  const { t } = useTranslation()
  const [activeView, setActiveView] = React.useState<"files" | "home">("home")

  return (
    <Sidebar
      id="workspace-sidebar"
      side="right"
      role="complementary"
      aria-label={t("workspace.label")}
      className={className}
      style={style}
      resizable={resizable}
      resizeLabel={t("workspace.resize")}
      mobileTitle={t("workspace.label")}
      mobileDescription={t("workspace.description")}
    >
      <WorkspaceToggle className="absolute top-1 right-4 z-20 md:hidden" />
      <SidebarContent
        className={
          activeView === "home"
            ? "items-start justify-center"
            : "gap-0 overflow-hidden"
        }
      >
        {activeView === "files" ? (
          <WorkspaceFileView onBack={() => setActiveView("home")} />
        ) : (
          <WorkspaceHome
            onAction={(actionId) => {
              if (actionId === "files") {
                setActiveView("files")
              }
            }}
          />
        )}
      </SidebarContent>
    </Sidebar>
  )
}
