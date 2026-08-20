"use client"

import {
  FilesIcon,
  ListTodoIcon,
  PackageIcon,
  TerminalIcon,
  type LucideIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"

type WorkspaceAction = {
  id: string
  available: boolean
  labelKey: string
  icon: LucideIcon
}

const workspaceActions: WorkspaceAction[] = [
  {
    id: "tasks",
    available: false,
    labelKey: "workspace.home.tasksAndActivity",
    icon: ListTodoIcon,
  },
  {
    id: "files",
    available: true,
    labelKey: "workspace.home.files",
    icon: FilesIcon,
  },
  {
    id: "terminal",
    available: false,
    labelKey: "workspace.home.terminal",
    icon: TerminalIcon,
  },
  {
    id: "artifacts",
    available: false,
    labelKey: "workspace.home.artifacts",
    icon: PackageIcon,
  },
]

export function WorkspaceHome({
  onAction,
}: {
  onAction?: (actionId: string) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex w-full max-w-sm flex-col gap-1 p-4">
      {workspaceActions.map((action) => {
        const Icon = action.icon
        const label = t(action.labelKey)
        const title = action.available
          ? label
          : t("workspace.home.unavailable", { action: label })

        return (
          <Button
            key={action.id}
            type="button"
            variant="ghost"
            disabled={!action.available}
            data-workspace-action={action.id}
            aria-label={title}
            title={title}
            className="h-14 w-full justify-start gap-3 px-3 text-left font-normal"
            onClick={() => {
              if (action.available) {
                onAction?.(action.id)
              }
            }}
          >
            <Icon
              className="size-5"
              strokeWidth={1}
              aria-hidden="true"
            />
            <span className="min-w-0 truncate">{label}</span>
          </Button>
        )
      })}
    </div>
  )
}
