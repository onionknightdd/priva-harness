export type SidebarContentView = "usage" | "file-browser" | "skills" | "mcp"

export type AppView = "agent-message" | SidebarContentView

export function isSidebarContentView(
  view: AppView
): view is SidebarContentView {
  return view !== "agent-message"
}
