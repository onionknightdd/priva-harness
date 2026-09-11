"use client"

import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { ExpandableTabs } from "@/components/motion/expandable-tabs"

import { WorkspaceWorkflowView } from "./views/workspace-workflow-view"
import { WorkspaceFileView } from "./views/workspace-file-view"
import { WorkspacePlaceholderView } from "./views/workspace-placeholder-view"
import {
  WORKSPACE_MODULES,
  isWorkspaceModuleId,
  type WorkspaceModuleId,
} from "./workspace-modules"

function WorkspaceModuleContent({
  moduleId,
  onFileBrowserMinimumWidthChange,
}: {
  moduleId: WorkspaceModuleId
  onFileBrowserMinimumWidthChange?: (width: number) => void
}) {
  if (moduleId === "tasks") return <WorkspaceWorkflowView />
  if (moduleId === "files") {
    return (
      <WorkspaceFileView
        onMinimumWidthChange={onFileBrowserMinimumWidthChange}
      />
    )
  }

  return <WorkspacePlaceholderView moduleId={moduleId} />
}

export function WorkspaceTabs({
  activeId,
  onActiveIdChange,
  onFileBrowserMinimumWidthChange,
  onMinimumWidthChange,
}: {
  activeId: WorkspaceModuleId
  onActiveIdChange: (id: WorkspaceModuleId) => void
  onFileBrowserMinimumWidthChange?: (width: number) => void
  onMinimumWidthChange?: (width: number) => void
}) {
  const { t } = useTranslation()

  // Stable item elements let React bail out of the kept-mounted file browser
  // when only the active tab (or the shell around it) changes.
  const items = useMemo(
    () =>
      WORKSPACE_MODULES.map((module) => {
        const Icon = module.icon
        const label = t(module.labelKey)

        return {
          id: module.id,
          keepMounted: module.id === "files",
          label,
          icon: <Icon aria-hidden="true" />,
          content: (
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <WorkspaceModuleContent
                moduleId={module.id}
                onFileBrowserMinimumWidthChange={
                  onFileBrowserMinimumWidthChange
                }
              />
            </div>
          ),
        }
      }),
    [onFileBrowserMinimumWidthChange, t]
  )

  return (
    <ExpandableTabs
      items={items}
      value={activeId}
      ariaLabel={t("workspace.tabs.listLabel")}
      onMinimumWidthChange={onMinimumWidthChange}
      onValueChange={(id) => {
        if (id && isWorkspaceModuleId(id)) {
          onActiveIdChange(id)
        }
      }}
      className="h-full"
    />
  )
}
