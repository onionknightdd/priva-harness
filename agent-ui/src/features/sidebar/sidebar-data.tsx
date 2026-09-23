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
  WebhookIcon,
} from "lucide-react"

import type { SidebarData } from "./sidebar.types"

// Navigation content kept separate from the Sidebar composition.
export const sidebarData = {
  menu: [
    {
      titleKey: "sidebar.navigation.newAgentMessage",
      view: "agent-message",
      action: "new-agent-message",
      icon: PlusIcon,
    },
    {
      titleKey: "sidebar.navigation.automation",
      icon: CalendarClockIcon,
      disabled: true,
    },
    {
      titleKey: "sidebar.navigation.plugins",
      icon: PackageSearchIcon,
      items: [
        {
          titleKey: "sidebar.navigation.agentSkill",
          view: "skills",
          icon: <ScrollTextIcon />,
        },
        {
          titleKey: "sidebar.navigation.mcp",
          view: "mcp",
          icon: <CableIcon />,
        },
        {
          titleKey: "sidebar.navigation.hook",
          icon: <WebhookIcon />,
          disabled: true,
        },
        {
          titleKey: "sidebar.navigation.subAgent",
          icon: <BotIcon />,
          disabled: true,
        },
        {
          titleKey: "sidebar.navigation.memory",
          icon: <NotebookPenIcon />,
          disabled: true,
        },
      ],
    },
    {
      titleKey: "sidebar.navigation.dataAndUsage",
      icon: ChartNoAxesCombinedIcon,
      items: [
        {
          titleKey: "sidebar.navigation.usage",
          view: "usage",
          icon: <ChartNoAxesColumnIncreasingIcon />,
        },
        {
          titleKey: "sidebar.navigation.activityAndTraces",
          icon: <ActivityIcon />,
          disabled: true,
        },
        {
          titleKey: "sidebar.navigation.fileBrowser",
          view: "file-browser",
          icon: <FolderSearchIcon />,
        },
      ],
    },
  ],
} satisfies SidebarData
