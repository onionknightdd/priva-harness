import {
  CalendarClockIcon,
  ChartNoAxesCombinedIcon,
  PackageSearchIcon,
  PlusIcon,
} from "@animateicons/react/lucide"
import {
  ActivityIcon,
  BotIcon,
  CableIcon,
  ChartNoAxesColumnIncreasingIcon,
  FolderSearchIcon,
  NotebookPenIcon,
  ScrollTextIcon,
  UploadIcon,
  WebhookIcon,
} from "lucide-react"

import type { SidebarData } from "./sidebar.types"

// Navigation content kept separate from the Sidebar composition.
export const sidebarData = {
  menu: [
    {
      titleKey: "sidebar.navigation.newChat",
      view: "workspace",
      action: "new-chat",
      icon: PlusIcon,
    },
    {
      titleKey: "sidebar.navigation.automation",
      icon: CalendarClockIcon,
    },
    {
      titleKey: "sidebar.navigation.plugins",
      icon: PackageSearchIcon,
      items: [
        {
          titleKey: "sidebar.navigation.agentSkill",
          icon: <ScrollTextIcon />,
        },
        {
          titleKey: "sidebar.navigation.mcp",
          icon: <CableIcon />,
        },
        {
          titleKey: "sidebar.navigation.hook",
          icon: <WebhookIcon />,
        },
        {
          titleKey: "sidebar.navigation.subAgent",
          icon: <BotIcon />,
        },
        {
          titleKey: "sidebar.navigation.memory",
          icon: <NotebookPenIcon />,
        },
      ],
    },
    {
      titleKey: "sidebar.navigation.dataAndUsage",
      icon: ChartNoAxesCombinedIcon,
      items: [
        {
          titleKey: "sidebar.navigation.usage",
          icon: <ChartNoAxesColumnIncreasingIcon />,
        },
        {
          titleKey: "sidebar.navigation.activityAndTraces",
          icon: <ActivityIcon />,
        },
        {
          titleKey: "sidebar.navigation.uploads",
          icon: <UploadIcon />,
        },
        {
          titleKey: "sidebar.navigation.fileBrowser",
          view: "file-browser",
          icon: <FolderSearchIcon />,
        },
      ],
    },
  ],
  projects: [],
} satisfies SidebarData
