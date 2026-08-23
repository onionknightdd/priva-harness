"use client"
// beui.dev/components/blocks/expandable-tabs
// Fill layout: the panel uses remaining height so Workspace content can scroll.
// The tab bar sits on top. The active tab stays selected.

import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Variants,
} from "motion/react"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"

export type ExpandableTabsItem = {
  id: string
  /** String label — shown inside the active tab and used as the button's accessible name. */
  label: string
  icon: ReactNode
  /** Panel shown below the bar when this tab is active. */
  content: ReactNode
}

export type ExpandableTabsClassNames = {
  root?: string
  panel?: string
  bar?: string
  tab?: string
  activeTab?: string
  icon?: string
  label?: string
}

export interface ExpandableTabsProps {
  items: ExpandableTabsItem[]
  value?: string | null
  defaultValue?: string | null
  onValueChange?: (id: string | null) => void
  ariaLabel?: string
  className?: string
  classNames?: ExpandableTabsClassNames
}

const TAB_CHANGE_SPRING = {
  type: "spring",
  duration: 0.46,
  bounce: 0.04,
} as const
const LABEL_SPRING = TAB_CHANGE_SPRING

const TAB_W = 32
const ICON_W = 14
const TAB_PAD_X = 8
const LABEL_GAP = 4

const CONTENT_VARIANTS: Variants = {
  enter: { y: -8, scale: 0.98, opacity: 0, filter: "blur(4px)" },
  center: { y: 0, scale: 1, opacity: 1, filter: "blur(0px)" },
  exit: {
    y: -6,
    scale: 0.98,
    opacity: 0,
    filter: "blur(4px)",
    transition: { duration: 0.08, ease: EASE_OUT },
  },
}

const REDUCED_CONTENT_VARIANTS: Variants = {
  enter: { opacity: 0, filter: "blur(0px)" },
  center: { opacity: 1, filter: "blur(0px)" },
  exit: {
    opacity: 0,
    filter: "blur(0px)",
    transition: { duration: 0.08, ease: EASE_OUT },
  },
}

const CONTENT_SPRING = { type: "spring", duration: 0.46, bounce: 0.08 } as const

const tabButtonClassName =
  "flex h-full w-full min-w-0 items-center justify-start overflow-hidden rounded-full border-0 bg-transparent px-2 text-sm font-medium shadow-none outline-none transition-[color,background-color] select-none hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

function sameWidths(a: Record<string, number>, b: Record<string, number>) {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)

  if (aKeys.length !== bKeys.length) {
    return false
  }

  return aKeys.every((key) => a[key] === b[key])
}

function useLabelWidths(items: ExpandableTabsItem[]) {
  const refs = useRef<Record<string, HTMLSpanElement | null>>({})
  const [widths, setWidths] = useState<Record<string, number>>({})

  const setLabelMeasureRef = useCallback(
    (id: string) => (node: HTMLSpanElement | null) => {
      refs.current[id] = node
    },
    []
  )

  const measure = useCallback(() => {
    const next: Record<string, number> = {}

    for (const item of items) {
      const node = refs.current[item.id]

      if (node) {
        next[item.id] = Math.ceil(node.offsetWidth)
      }
    }

    setWidths((current) => (sameWidths(current, next) ? current : next))
  }, [items])

  useLayoutEffect(() => {
    measure()
  }, [measure])

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      return
    }

    const observer = new ResizeObserver(measure)

    for (const item of items) {
      const node = refs.current[item.id]

      if (node) {
        observer.observe(node)
      }
    }

    return () => observer.disconnect()
  }, [items, measure])

  return { setLabelMeasureRef, widths }
}

export function ExpandableTabs({
  items,
  value,
  defaultValue = null,
  onValueChange,
  ariaLabel = "Navigation tabs",
  className,
  classNames,
}: ExpandableTabsProps) {
  const reduce = Boolean(useReducedMotion())
  const { setLabelMeasureRef, widths: labelWidths } = useLabelWidths(items)

  const controlled = value !== undefined
  const [internal, setInternal] = useState(defaultValue)
  const activeId = controlled ? value : internal
  const active = items.find((item) => item.id === activeId) ?? null
  const visualActiveId = active?.id ?? null

  const setActive = useCallback(
    (next: string | null) => {
      if (!controlled) {
        setInternal(next)
      }
      onValueChange?.(next)
    },
    [controlled, onValueChange]
  )

  const getActiveTabWidth = useCallback(
    (item: ExpandableTabsItem) =>
      Math.max(
        TAB_W,
        TAB_PAD_X +
          ICON_W +
          LABEL_GAP +
          (labelWidths[item.id] ?? 0) +
          TAB_PAD_X
      ),
    [labelWidths]
  )

  if (!items.length) {
    return null
  }

  return (
    <>
      <div
        className={cn(
          "relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[26px] bg-workspace-panel",
          className,
          classNames?.root
        )}
      >
        <div
          role="tablist"
          aria-label={ariaLabel}
          aria-orientation="horizontal"
          className={cn(
            "relative z-20 flex h-8 w-full shrink-0 items-center gap-1 px-1.5 pr-24",
            classNames?.bar
          )}
        >
          {items.map((item) => {
            const isActive = item.id === visualActiveId
            const labelWidth = labelWidths[item.id] ?? 0
            const measured = labelWidth > 0
            const targetWidth =
              isActive && measured ? getActiveTabWidth(item) : TAB_W
            const targetLabelWidth = isActive && measured ? labelWidth : 0
            const targetLabelGap = isActive && measured ? LABEL_GAP : 0

            return (
              <motion.div
                key={item.id}
                initial={false}
                animate={{ width: targetWidth }}
                transition={reduce ? { duration: 0 } : TAB_CHANGE_SPRING}
                className={cn(
                  "relative flex h-8 shrink-0 overflow-hidden rounded-full",
                  isActive
                    ? "bg-workspace-tab-active text-foreground"
                    : "text-muted-foreground"
                )}
                style={{ originX: 0 }}
              >
                <Tooltip disabled={isActive} open={isActive ? false : undefined}>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        aria-label={item.label}
                        onClick={() => {
                          if (!isActive) {
                            setActive(item.id)
                          }
                        }}
                        className={cn(
                          tabButtonClassName,
                          classNames?.tab,
                          isActive && classNames?.activeTab
                        )}
                      />
                    }
                  >
                    <span
                      className={cn(
                        "grid size-3.5 shrink-0 place-items-center [&_svg]:size-3.5",
                        classNames?.icon
                      )}
                    >
                      {item.icon}
                    </span>
                    <motion.span
                      aria-hidden
                      initial={false}
                      animate={{
                        width: targetLabelWidth,
                        opacity: targetLabelWidth > 0 ? 1 : 0,
                        marginLeft: targetLabelGap,
                      }}
                      transition={reduce ? { duration: 0 } : LABEL_SPRING}
                      className={cn(
                        "block overflow-hidden text-sm font-medium whitespace-nowrap",
                        classNames?.label
                      )}
                    >
                      {item.label}
                    </motion.span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={6}>
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              </motion.div>
            )
          })}
        </div>

        <div
          className={cn(
            "relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden px-1.5 pt-2 pb-0",
            classNames?.panel
          )}
        >
          <AnimatePresence initial={false} mode="wait">
            {active ? (
              <motion.div
                key={active.id}
                variants={reduce ? REDUCED_CONTENT_VARIANTS : CONTENT_VARIANTS}
                initial="enter"
                animate="center"
                exit="exit"
                transition={
                  reduce ? { duration: 0.15, ease: EASE_OUT } : CONTENT_SPRING
                }
                className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-[18px]"
                style={{
                  transformOrigin: "top center",
                  willChange: "transform, opacity, filter",
                }}
              >
                {active.content}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed top-0 left-0 -z-10 flex opacity-0"
      >
        {items.map((item) => (
          <span
            className={cn(
              "text-sm leading-none font-medium whitespace-nowrap",
              classNames?.label
            )}
            key={item.id}
            ref={setLabelMeasureRef(item.id)}
          >
            {item.label}
          </span>
        ))}
      </div>
    </>
  )
}
