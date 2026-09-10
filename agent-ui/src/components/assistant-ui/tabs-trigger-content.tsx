"use client"

import type { LucideIcon } from "lucide-react"
import { motion } from "motion/react"

export function TabsTriggerContent({
  active,
  icon: Icon,
  label,
  reduceMotion,
}: {
  active: boolean
  icon: LucideIcon
  label: string
  reduceMotion: boolean
}) {
  if (!active) {
    return <span className="truncate">{label}</span>
  }

  if (reduceMotion) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <Icon />
        <span className="truncate">{label}</span>
      </span>
    )
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <motion.span
        className="inline-flex shrink-0"
        initial={{ opacity: 0.45, y: 2, scale: 0.72, rotate: -12 }}
        animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 24 }}
      >
        <Icon />
      </motion.span>
      <motion.span
        className="truncate"
        initial={{ opacity: 0.45, x: -3, y: 2 }}
        animate={{ opacity: 1, x: 0, y: 0 }}
        transition={{
          type: "spring",
          stiffness: 360,
          damping: 28,
          delay: 0.04,
        }}
      >
        {label}
      </motion.span>
    </span>
  )
}
