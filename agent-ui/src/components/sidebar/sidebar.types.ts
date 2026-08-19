import type {
  ForwardRefExoticComponent,
  ReactNode,
  RefAttributes,
} from "react"

import type { AppView } from "@/lib/app-view"

export type SidebarAnimatedIconHandle = {
  startAnimation: () => void
  stopAnimation: () => void
}

type SidebarAnimatedIconProps = {
  size?: number
  duration?: number
  isAnimated?: boolean
  color?: string
  className?: string
  "aria-hidden"?: boolean | "true" | "false"
}

export type SidebarAnimatedIcon = ForwardRefExoticComponent<
  SidebarAnimatedIconProps & RefAttributes<SidebarAnimatedIconHandle>
>

export type SidebarUser = {
  name: string
  email: string
  avatar: string
}

export type SidebarNavSubItem = {
  titleKey: string
  view?: AppView
  icon: ReactNode
}

export type SidebarNavItem = {
  titleKey: string
  view?: AppView
  icon: SidebarAnimatedIcon
  items?: SidebarNavSubItem[]
}

export type SidebarProject = {
  name: string
  url: string
}

export type SidebarData = {
  user: SidebarUser
  menu: SidebarNavItem[]
  projects: SidebarProject[]
}
