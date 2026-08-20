import { SparklesIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"

export function ChatEmptyState() {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())

  return (
    <Empty className="flex-none p-0">
      <EmptyHeader>
        <EmptyTitle className="flex items-center gap-2 [&_svg]:size-5">
          <motion.span
            className="inline-flex"
            initial={
              shouldReduceMotion ? false : { opacity: 0, scale: 0.6, rotate: -12 }
            }
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 18 }}
          >
            <SparklesIcon />
          </motion.span>
          {t("chat.emptyTitle")}
        </EmptyTitle>
      </EmptyHeader>
    </Empty>
  )
}
