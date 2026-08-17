"use client"

import * as React from "react"
import { useTranslation } from "react-i18next"

import {
  Sidebar,
  SidebarContent,
} from "@/components/ui/sidebar"

import { CanvasHome } from "./canvas-home"
import { CanvasToggle } from "./canvas-toggle"
import { CanvasFileView } from "./views/canvas-file-view"

export function CanvasSidebar() {
  const { t } = useTranslation()
  const [activeView, setActiveView] = React.useState<"files" | "home">("home")

  return (
    <Sidebar
      id="canvas-sidebar"
      side="right"
      role="complementary"
      aria-label={t("canvas.label")}
      resizable
      resizeLabel={t("canvas.resize")}
      mobileTitle={t("canvas.label")}
      mobileDescription={t("canvas.description")}
    >
      <CanvasToggle className="absolute top-1 right-4 z-20 md:hidden" />
      <SidebarContent
        className={
          activeView === "home"
            ? "items-start justify-center"
            : "gap-0 overflow-hidden"
        }
      >
        {activeView === "files" ? (
          <CanvasFileView onBack={() => setActiveView("home")} />
        ) : (
          <CanvasHome
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
