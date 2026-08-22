"use client"

import * as React from "react"
import { FolderIcon } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { cn } from "@/lib/utils"
import {
  useWorkspaceTakesMajority,
  workspaceDensityTransition,
} from "@/features/workspace"

function parseCwd(cwd: string) {
  const trimmed = cwd.trim()
  const windows = /^[A-Za-z]:[\\/]/.test(trimmed)
  const sep = windows ? "\\" : "/"
  const absolute = trimmed.startsWith("/") || windows
  const parts = trimmed.split(/[/\\]/u).filter(Boolean)

  return { sep, parts, absolute }
}

function PathSeparator({ sep }: { sep: string }) {
  return (
    <BreadcrumbSeparator className="mx-0 shrink-0 px-0.5 text-muted-foreground">
      {sep}
    </BreadcrumbSeparator>
  )
}

function PathSepText({ sep }: { sep: string }) {
  return (
    <span className="mx-0 shrink-0 px-0.5 text-muted-foreground">{sep}</span>
  )
}

function CwdBreadcrumbTrail({
  parts,
  sep,
  absolute,
  collapsed,
  truncateLast,
}: {
  parts: readonly string[]
  sep: string
  absolute: boolean
  collapsed: boolean
  truncateLast: boolean
}) {
  const shouldReduceMotion = Boolean(useReducedMotion())
  const transition = shouldReduceMotion
    ? { duration: 0 }
    : workspaceDensityTransition
  const showCollapsed = collapsed && parts.length > 2
  const first = parts[0]
  const last = parts[parts.length - 1]
  const middle = parts.slice(1, -1)

  return (
    <BreadcrumbList className="flex-nowrap gap-0 break-normal text-xs sm:gap-0">
      {absolute && sep === "/" ? <PathSeparator sep={sep} /> : null}
      {first ? (
        <BreadcrumbItem className="shrink-0">
          {parts.length === 1 ? (
            <BreadcrumbPage className="text-xs font-normal text-muted-foreground">
              {first}
            </BreadcrumbPage>
          ) : (
            <span className="truncate">{first}</span>
          )}
        </BreadcrumbItem>
      ) : null}
      <AnimatePresence initial={false} mode="popLayout">
        {parts.length > 2 ? (
          showCollapsed ? (
            <motion.li
              key="cwd-ellipsis"
              className="inline-flex items-center overflow-hidden whitespace-nowrap"
              initial={shouldReduceMotion ? false : { opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={shouldReduceMotion ? undefined : { opacity: 0, width: 0 }}
              transition={transition}
            >
              <PathSepText sep={sep} />
              <BreadcrumbEllipsis className="size-4 [&>svg]:size-3.5" />
            </motion.li>
          ) : (
            <motion.li
              key="cwd-middle"
              className="inline-flex items-center overflow-hidden whitespace-nowrap"
              initial={shouldReduceMotion ? false : { opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={shouldReduceMotion ? undefined : { opacity: 0, width: 0 }}
              transition={transition}
            >
              {middle.map((part, index) => (
                <React.Fragment key={`${part}-${index}`}>
                  <PathSepText sep={sep} />
                  <span className="truncate">{part}</span>
                </React.Fragment>
              ))}
            </motion.li>
          )
        ) : null}
      </AnimatePresence>
      {parts.length > 1 && last ? (
        <>
          <PathSeparator sep={sep} />
          <BreadcrumbItem
            className={cn("min-w-0", truncateLast ? "shrink" : "shrink-0")}
          >
            <BreadcrumbPage
              className={cn(
                "text-xs font-normal text-muted-foreground",
                truncateLast && "truncate"
              )}
            >
              {last}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </>
      ) : null}
    </BreadcrumbList>
  )
}

export function SessionCwdBreadcrumb({
  cwd,
  className,
}: {
  cwd: string
  className?: string
}) {
  const { t } = useTranslation()
  const { sep, parts, absolute } = parseCwd(cwd)
  const forceCollapsed = useWorkspaceTakesMajority()
  const [hovered, setHovered] = React.useState(false)
  const [focused, setFocused] = React.useState(false)
  const [overflows, setOverflows] = React.useState(parts.length > 2)
  const capRef = React.useRef<HTMLSpanElement>(null)
  const measureRef = React.useRef<HTMLDivElement>(null)
  const expanded = hovered || focused

  React.useLayoutEffect(() => {
    const cap = capRef.current
    const measure = measureRef.current

    if (!cap || !measure) {
      return
    }

    const update = () => {
      if (cap.offsetWidth === 0) {
        return
      }

      setOverflows(measure.scrollWidth > cap.offsetWidth)
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(cap)
    observer.observe(measure)

    return () => observer.disconnect()
  }, [cwd])

  const collapse = !expanded && (overflows || forceCollapsed)
  const trail = {
    parts,
    sep,
    absolute,
  }

  if (parts.length === 0) {
    return null
  }

  return (
    <div
      className={cn(
        "group/cwd relative ml-[calc(0.5rem+1px)] flex w-fit min-w-0 max-w-[20cqw] items-center gap-1 overflow-hidden rounded-sm text-xs text-muted-foreground outline-none transition-[max-width] duration-200 ease-out hover:max-w-full hover:overflow-x-auto focus-within:max-w-full focus-within:overflow-x-auto focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none",
        expanded && "max-w-full overflow-x-auto",
        className
      )}
      tabIndex={0}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false)
        }
      }}
    >
      <span
        ref={capRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute h-0 w-[20cqw]"
      />
      <div
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute flex items-center gap-1 whitespace-nowrap"
      >
        <span className="flex size-6 shrink-0 items-center justify-center">
          <FolderIcon className="size-4" />
        </span>
        <Breadcrumb>
          <CwdBreadcrumbTrail {...trail} collapsed={false} truncateLast={false} />
        </Breadcrumb>
      </div>
      <span className="flex size-6 shrink-0 items-center justify-center">
        <FolderIcon className="size-4" aria-hidden="true" />
      </span>
      <Breadcrumb
        aria-label={`${t("agentMessage.sessionCwd")}: ${cwd}`}
        className="min-w-0"
      >
        <CwdBreadcrumbTrail
          {...trail}
          collapsed={collapse}
          truncateLast={!expanded && overflows}
        />
      </Breadcrumb>
    </div>
  )
}
