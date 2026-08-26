import * as React from "react"
import gsap from "gsap"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { normalizeLanguage } from "@/i18n"
import { cn } from "@/lib/utils"

export function LanguageToggle({ className }: { className?: string }) {
  const labelRef = React.useRef<HTMLSpanElement>(null)
  const { i18n, t } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage)
  const isChinese = language === "zh-CN"
  const nextLanguage = isChinese ? "en" : "zh-CN"
  const accessibleLabel = isChinese
    ? t("language.switchToEnglish")
    : t("language.switchToChinese")

  React.useLayoutEffect(() => {
    const label = labelRef.current

    if (
      !label ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        label,
        { y: 1, scale: 0.78 },
        {
          y: 0,
          scale: 1,
          duration: 0.2,
          ease: "power2.out",
          clearProps: "transform",
        }
      )
    }, label)

    return () => context.revert()
  }, [language])

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn("shrink-0 border-0", className)}
      aria-label={accessibleLabel}
      title={accessibleLabel}
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
  )
}
