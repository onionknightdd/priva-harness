import {
  FilesIcon,
  ListTodoIcon,
  PackageIcon,
  TerminalIcon,
  type LucideIcon,
} from "lucide-react"

export const WORKSPACE_MODULE_IDS = [
  "tasks",
  "files",
  "terminal",
  "artifacts",
] as const

export type WorkspaceModuleId = (typeof WORKSPACE_MODULE_IDS)[number]

export type WorkspaceModule = {
  id: WorkspaceModuleId
  labelKey: string
  icon: LucideIcon
}

export const WORKSPACE_MODULES: WorkspaceModule[] = [
  {
    id: "tasks",
    labelKey: "workspace.home.tasksAndActivity",
    icon: ListTodoIcon,
  },
  {
    id: "files",
    labelKey: "workspace.home.files",
    icon: FilesIcon,
  },
  {
    id: "terminal",
    labelKey: "workspace.home.terminal",
    icon: TerminalIcon,
  },
  {
    id: "artifacts",
    labelKey: "workspace.home.artifacts",
    icon: PackageIcon,
  },
]

export function isWorkspaceModuleId(id: string): id is WorkspaceModuleId {
  return WORKSPACE_MODULE_IDS.some((moduleId) => moduleId === id)
}

export function getWorkspaceModule(id: WorkspaceModuleId): WorkspaceModule {
  const module = WORKSPACE_MODULES.find((item) => item.id === id)

  if (!module) {
    throw new Error(`Unknown workspace module: ${id}`)
  }

  return module
}
