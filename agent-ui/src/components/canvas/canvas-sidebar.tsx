"use client"

import { useTranslation } from "react-i18next"

import {
  Sidebar,
  SidebarContent,
} from "@/components/ui/sidebar"

import { CanvasHome } from "./canvas-home"
import { CanvasToggle } from "./canvas-toggle"

export function CanvasSidebar() {
  const { t } = useTranslation()

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
      <SidebarContent className="items-start justify-center">
        <CanvasHome />
      </SidebarContent>
    </Sidebar>
  )
}
