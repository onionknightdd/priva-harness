import * as React from "react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"

import { ProfileSidebarColumn } from "./profile-sidebar-column"
import { ProfileUsageColumn } from "./profile-usage-column"
import type { ProfileRangeWeeks } from "./mock-profile-data"

const panelTransition = {
  duration: 0.22,
  ease: [0.22, 1, 0.36, 1],
} as const

export function ProfileDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const [weeks, setWeeks] = React.useState<ProfileRangeWeeks>(12)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(52rem,calc(100svh-1.5rem))] w-full max-w-[calc(100%-1rem)] flex-col overflow-hidden bg-muted/40 p-0 sm:max-w-[calc(100%-2rem)] lg:max-w-[72rem]"
        closeButtonClassName="top-3 right-3"
      >
        <DialogTitle className="sr-only">{t("profile.title")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("profile.description")}
        </DialogDescription>
        <motion.div
          className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-[17.5rem_minmax(0,1fr)] md:p-5"
          initial={shouldReduceMotion ? false : { opacity: 0.7, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : panelTransition}
        >
          <aside className="md:sticky md:top-0 md:self-start">
            <ProfileSidebarColumn />
          </aside>
          <ProfileUsageColumn weeks={weeks} onWeeksChange={setWeeks} />
        </motion.div>
      </DialogContent>
    </Dialog>
  )
}
