/** Stable model-facing names; the renderer maps this catalog to Lucide components. */
export const DASHBOARD_ICON_NAMES = [
  "activity", "arrow-down", "arrow-left", "arrow-right", "arrow-up",
  "bell", "calendar", "chart-column", "chart-line", "chart-pie",
  "check", "circle-check", "circle-help", "circle-x", "clock",
  "credit-card", "dollar-sign", "download", "file-text", "folder",
  "globe", "heart", "house", "image", "info", "mail", "map-pin",
  "package", "percent", "search", "settings", "shopping-cart",
  "star", "target", "trending-down", "trending-up", "triangle-alert",
  "upload", "user", "users", "x",
] as const

export type DashboardIconName = typeof DASHBOARD_ICON_NAMES[number]
