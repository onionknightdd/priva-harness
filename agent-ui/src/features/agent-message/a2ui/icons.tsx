import {
  Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUp,
  Bell, Calendar, ChartColumn, ChartLine, ChartPie,
  Check, CircleCheck, CircleHelp, CircleX, Clock,
  CreditCard, DollarSign, Download, FileText, Folder,
  Globe, Heart, House, Image, Info, Mail, MapPin,
  Package, Percent, Search, Settings, ShoppingCart,
  Star, Target, TrendingDown, TrendingUp, TriangleAlert,
  Upload, User, Users, X, type LucideIcon,
} from "lucide-react"

import type { DashboardIconName } from "./icon-names"

// Static imports keep the supported icon set explicit and tree-shakeable.
const icons = {
  activity: Activity,
  "arrow-down": ArrowDown,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  "arrow-up": ArrowUp,
  bell: Bell,
  calendar: Calendar,
  "chart-column": ChartColumn,
  "chart-line": ChartLine,
  "chart-pie": ChartPie,
  check: Check,
  "circle-check": CircleCheck,
  "circle-help": CircleHelp,
  "circle-x": CircleX,
  clock: Clock,
  "credit-card": CreditCard,
  "dollar-sign": DollarSign,
  download: Download,
  "file-text": FileText,
  folder: Folder,
  globe: Globe,
  heart: Heart,
  house: House,
  image: Image,
  info: Info,
  mail: Mail,
  "map-pin": MapPin,
  package: Package,
  percent: Percent,
  search: Search,
  settings: Settings,
  "shopping-cart": ShoppingCart,
  star: Star,
  target: Target,
  "trending-down": TrendingDown,
  "trending-up": TrendingUp,
  "triangle-alert": TriangleAlert,
  upload: Upload,
  user: User,
  users: Users,
  x: X,
} satisfies Record<DashboardIconName, LucideIcon>

const sizes = { small: 16, medium: 20, large: 32 } as const

export function DashboardIcon({ name, size = "medium", tone = "default", label }: {
  name: DashboardIconName
  size?: keyof typeof sizes
  tone?: "default" | "muted" | "positive" | "negative"
  label?: string
}) {
  const Icon = icons[name]
  const accessibleLabel = label?.trim() || undefined

  return <Icon
    className="a2ui-icon"
    size={sizes[size]}
    data-tone={tone}
    role={accessibleLabel ? "img" : undefined}
    aria-label={accessibleLabel}
    aria-hidden={accessibleLabel ? undefined : true}
    focusable="false"
  />
}
