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
  labelKey: string
  icon: LucideIcon
}

const canvasActions: CanvasAction[] = [
  {
    id: "tasks",
    labelKey: "canvas.home.tasksAndActivity",
    icon: ListTodoIcon,
  },
  {
    id: "files",
    labelKey: "canvas.home.files",
    icon: FilesIcon,
  },
  {
    id: "terminal",
    labelKey: "canvas.home.terminal",
    icon: TerminalIcon,
  },
  {
    id: "artifacts",
    labelKey: "canvas.home.artifacts",
    icon: PackageIcon,
  },
]

export function CanvasHome() {
  const { t } = useTranslation()

  return (
    <div className="flex w-full max-w-sm flex-col gap-1 p-4">
      {canvasActions.map((action) => {
        const Icon = action.icon
        const label = t(action.labelKey)

        return (
          <Button
            key={action.id}
            type="button"
            variant="ghost"
            data-canvas-action={action.id}
            aria-label={label}
            className="h-14 w-full justify-start gap-3 px-3 text-left font-normal"
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
