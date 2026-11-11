import * as React from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { normalizeLanguage } from "@/i18n"
import { cn } from "@/lib/utils"
import { TooltipHint } from "@/components/ui/tooltip"
import { playMotion } from "@/lib/motion-effects"

export function LanguageToggle({ className }: { className?: string }) {
  const labelRef = React.useRef<HTMLSpanElement>(null)
  const { i18n, t } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage)
  const isChinese = language === "zh-CN"
  const nextLanguage = isChinese ? "en" : "zh-CN"
  const accessibleLabel = isChinese
    ? t("language.switchToEnglish")
    : t("language.switchToChinese")

  React.useLayoutEffect(
    () =>
      playMotion(labelRef.current, [{ translate: "0 1px", scale: 0.78 }], {
        duration: 200,
      }),
    [language]
  )

  return (
    <TooltipHint content={accessibleLabel}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn("shrink-0 border-0", className)}
        aria-label={accessibleLabel}
        onClick={() => void i18n.changeLanguage(nextLanguage)}
      >
        <span
          ref={labelRef}
          className="text-[11px] font-semibold tracking-wide"
          aria-live="polite"
        >
          {isChinese ? "ZH" : "EN"}
        </span>
      </Button>
    </TooltipHint>
  )
}
