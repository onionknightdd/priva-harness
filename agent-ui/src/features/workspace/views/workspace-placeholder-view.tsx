"use client"

import { useTranslation } from "react-i18next"

import { getWorkspaceModule, type WorkspaceModuleId } from "../workspace-modules"

export function WorkspacePlaceholderView({
  moduleId,
}: {
  moduleId: WorkspaceModuleId
}) {
  const { t } = useTranslation()
  const module = getWorkspaceModule(moduleId)
  const Icon = module.icon
  const label = t(module.labelKey)

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="grid size-12 place-items-center rounded-xl bg-workspace-tab-active text-muted-foreground">
        <Icon aria-hidden className="size-6" strokeWidth={1} />
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-medium">{label}</h2>
        <p className="text-sm text-muted-foreground">
          {t("workspace.home.unavailable", { action: label })}
        </p>
      </div>
    </div>
  )
}
