export type SidebarContentView = "file-browser"

export type AppView = "workspace" | SidebarContentView

export function isSidebarContentView(
  view: AppView
): view is SidebarContentView {
  return view !== "workspace"
}
