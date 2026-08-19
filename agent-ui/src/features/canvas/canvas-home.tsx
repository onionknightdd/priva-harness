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

type CanvasAction = {
  id: string
  available: boolean
  labelKey: string
  icon: LucideIcon
}

const canvasActions: CanvasAction[] = [
  {
    id: "tasks",
    available: false,
    labelKey: "canvas.home.tasksAndActivity",
    icon: ListTodoIcon,
  },
  {
    id: "files",
    available: true,
    labelKey: "canvas.home.files",
    icon: FilesIcon,
  },
  {
    id: "terminal",
    available: false,
    labelKey: "canvas.home.terminal",
    icon: TerminalIcon,
  },
  {
    id: "artifacts",
    available: false,
    labelKey: "canvas.home.artifacts",
    icon: PackageIcon,
  },
]

export function CanvasHome({
  onAction,
}: {
  onAction?: (actionId: string) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex w-full max-w-sm flex-col gap-1 p-4">
      {canvasActions.map((action) => {
        const Icon = action.icon
        const label = t(action.labelKey)
        const title = action.available
          ? label
          : t("canvas.home.unavailable", { action: label })

        return (
          <Button
            key={action.id}
            type="button"
            variant="ghost"
            disabled={!action.available}
            data-canvas-action={action.id}
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
