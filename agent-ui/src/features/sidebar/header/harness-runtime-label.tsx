import * as React from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import { CollapsingInline } from "@/components/motion/collapsing-inline"

import { HarnessBrandLogo } from "./harness-brand-logo"
import type { HarnessId } from "./harness-options"

export function HarnessRuntimeLabel({ harnessId, name }: { harnessId: HarnessId; name: string }) {
  const viewportRef = React.useRef<HTMLSpanElement>(null)
  const measurementRef = React.useRef<HTMLSpanElement>(null)
  const [showName, setShowName] = React.useState(false)
  const reduceMotion = Boolean(useReducedMotion())
  const icon = <HarnessBrandLogo className={harnessId === "pi" ? "size-3 shrink-0" : "size-3.5 shrink-0"} harnessId={harnessId} />

  React.useLayoutEffect(() => {
    const viewport = viewportRef.current
    const measurement = measurementRef.current
    if (!viewport || !measurement) return

    const measure = () => {
      setShowName(measurement.getBoundingClientRect().width <= viewport.getBoundingClientRect().width)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    // Keep measuring the full label while collapsed, including changes in font metrics.
    observer.observe(measurement)
    return () => observer.disconnect()
  }, [harnessId, name])

  return (
    <span ref={viewportRef} data-slot="harness-runtime-label" className="relative flex min-w-0 flex-1 items-center">
      <span aria-hidden="true" className="pointer-events-none invisible absolute inset-0 overflow-hidden">
        <span ref={measurementRef} data-slot="harness-runtime-measurement" className="inline-flex w-max items-center gap-1 whitespace-nowrap">
          {icon}
          <span>{name}</span>
        </span>
      </span>
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={harnessId}
          data-runtime-logo
          className="inline-flex min-w-0 max-w-full items-center"
          initial={reduceMotion ? false : { opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -5 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          {icon}
          <CollapsingInline open={showName}>
            <span className="whitespace-nowrap">{name}</span>
          </CollapsingInline>
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
