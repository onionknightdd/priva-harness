"use client"

import { useTranslation } from "react-i18next"

import { ExpandableTabs } from "@/components/motion/expandable-tabs"

import { WorkspaceFileView } from "./views/workspace-file-view"
import { WorkspacePlaceholderView } from "./views/workspace-placeholder-view"
import {
  WORKSPACE_MODULES,
  isWorkspaceModuleId,
  type WorkspaceModuleId,
} from "./workspace-modules"

function WorkspaceModuleContent({
  moduleId,
}: {
  moduleId: WorkspaceModuleId
}) {
  if (moduleId === "files") {
    return <WorkspaceFileView />
  }

  return <WorkspacePlaceholderView moduleId={moduleId} />
}

export function WorkspaceTabs({
  activeId,
  onActiveIdChange,
}: {
  activeId: WorkspaceModuleId
  onActiveIdChange: (id: WorkspaceModuleId) => void
}) {
  const { t } = useTranslation()

  const items = WORKSPACE_MODULES.map((module) => {
    const Icon = module.icon
    const label = t(module.labelKey)

    return {
      id: module.id,
      label,
      icon: <Icon aria-hidden="true" />,
      content: (
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <WorkspaceModuleContent moduleId={module.id} />
        </div>
      ),
    }
  })

  return (
    <ExpandableTabs
      items={items}
      value={activeId}
      ariaLabel={t("workspace.tabs.listLabel")}
      onValueChange={(id) => {
        if (id && isWorkspaceModuleId(id)) {
          onActiveIdChange(id)
        }
      }}
      className="h-full"
    />
  )
}
