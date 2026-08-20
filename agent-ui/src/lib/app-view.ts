export type SidebarContentView = "file-browser"

export type AppView = "agent-message" | SidebarContentView

export function isSidebarContentView(
  view: AppView
): view is SidebarContentView {
  return view !== "agent-message"
}
