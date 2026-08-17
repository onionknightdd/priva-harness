import {
  CalendarClockIcon,
  ChartNoAxesCombinedIcon,
  PackageSearchIcon,
  PlusIcon,
} from "@animateicons/react/lucide"
import {
  ActivityIcon,
  AudioLinesIcon,
  BotIcon,
  CableIcon,
  ChartNoAxesColumnIncreasingIcon,
  FolderSearchIcon,
  GalleryVerticalEndIcon,
  NotebookPenIcon,
  ScrollTextIcon,
  TerminalIcon,
  UploadIcon,
  WebhookIcon,
} from "lucide-react"

import type { SidebarData } from "./sidebar.types"

// Sample content kept separate from the Sidebar composition for easy replacement.
export const sidebarData = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "https://ui.shadcn.com/avatars/shadcn.jpg",
  },
  teams: [
    {
      name: "Acme Inc",
      logo: <GalleryVerticalEndIcon />,
      planKey: "sidebar.plans.enterprise",
    },
    {
      name: "Acme Corp.",
      logo: <AudioLinesIcon />,
      planKey: "sidebar.plans.startup",
    },
    {
      name: "Evil Corp.",
      logo: <TerminalIcon />,
      planKey: "sidebar.plans.free",
    },
  ],
  menu: [
    {
      titleKey: "sidebar.navigation.newChat",
      url: "#",
      icon: PlusIcon,
    },
    {
      titleKey: "sidebar.navigation.automation",
      url: "#",
      icon: CalendarClockIcon,
    },
    {
      titleKey: "sidebar.navigation.plugins",
      url: "#",
      icon: PackageSearchIcon,
      items: [
        {
          titleKey: "sidebar.navigation.agentSkill",
          url: "#",
          icon: <ScrollTextIcon />,
        },
        {
          titleKey: "sidebar.navigation.mcp",
          url: "#",
          icon: <CableIcon />,
        },
        {
          titleKey: "sidebar.navigation.hook",
          url: "#",
          icon: <WebhookIcon />,
        },
        {
          titleKey: "sidebar.navigation.subAgent",
          url: "#",
          icon: <BotIcon />,
        },
        {
          titleKey: "sidebar.navigation.memory",
          url: "#",
          icon: <NotebookPenIcon />,
        },
      ],
    },
    {
      titleKey: "sidebar.navigation.dataAndUsage",
      url: "#",
      icon: ChartNoAxesCombinedIcon,
      items: [
        {
          titleKey: "sidebar.navigation.usage",
          url: "#",
          icon: <ChartNoAxesColumnIncreasingIcon />,
        },
        {
          titleKey: "sidebar.navigation.activityAndTraces",
          url: "#",
          icon: <ActivityIcon />,
        },
        {
          titleKey: "sidebar.navigation.uploads",
          url: "#",
          icon: <UploadIcon />,
        },
        {
          titleKey: "sidebar.navigation.fileBrowser",
          url: "#",
          icon: <FolderSearchIcon />,
        },
      ],
    },
  ],
  projects: [
    {
      name: "Design Engineering",
      url: "#",
    },
    {
      name: "Sales & Marketing",
      url: "#",
    },
    {
      name: "Travel",
      url: "#",
    },
  ],
} satisfies SidebarData
