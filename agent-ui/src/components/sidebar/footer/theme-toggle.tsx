import { useTheme } from "next-themes"
import { useTranslation } from "react-i18next"

import { ThemeTogglerButton } from "@/components/animate-ui/components/buttons/theme-toggler"
import { cn } from "@/lib/utils"

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme } = useTheme()
  const { t } = useTranslation()
  const accessibleLabel =
    resolvedTheme === "dark"
      ? t("theme.switchToLight")
      : t("theme.switchToDark")

  return (
    <ThemeTogglerButton
      type="button"
      variant="ghost"
      size="sm"
      modes={["light", "dark"]}
      direction="btt"
      className={cn("shrink-0 border-0", className)}
      aria-label={accessibleLabel}
      title={accessibleLabel}
    />
  )
}
