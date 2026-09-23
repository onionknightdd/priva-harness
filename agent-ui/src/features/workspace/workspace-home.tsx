"use client"

import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"

import { WORKSPACE_MODULES, type WorkspaceModuleId } from "./workspace-modules"
import { TooltipHint } from "@/components/ui/tooltip"

export function WorkspaceHome({
  onAction,
}: {
  onAction: (actionId: WorkspaceModuleId) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex w-full max-w-sm flex-col gap-1 p-4">
      {WORKSPACE_MODULES.map((module) => {
        const Icon = module.icon
        const label = t(module.labelKey)
        const tooltip = module.disabled ? `${label} (${t("common.comingSoon")})` : label

        return (
          <TooltipHint key={module.id} content={tooltip}>
            <Button
              key={module.id}
              type="button"
              variant="ghost"
              data-workspace-action={module.id}
              aria-label={tooltip}
              disabled={module.disabled}
              className="h-14 w-full justify-start gap-3 px-3 text-left font-normal"
              onClick={module.disabled ? undefined : () => onAction(module.id)}
            >
              <Icon className="size-5" strokeWidth={1} aria-hidden="true" />
              <span className="min-w-0 truncate">{label}</span>
              {module.disabled && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  ({t("common.comingSoon")})
                </span>
              )}
            </Button>
          </TooltipHint>
        )
      })}
    </div>
  )
}
