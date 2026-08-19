"use client"

import * as React from "react"
import {
  ChevronRightIcon,
  Maximize2Icon,
  Minimize2Icon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Transition,
} from "motion/react"
import { useTranslation } from "react-i18next"

import { buttonVariants } from "@/components/ui/button"
import {
  SidebarGroupLabel,
  SidebarInput,
} from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const searchTransition: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 34,
  mass: 0.75,
}

const actionTransition: Transition = {
  type: "spring",
  stiffness: 480,
  damping: 28,
}

function ProjectHeaderAction({
  label,
  reduceMotion,
  className,
  children,
  ...props
}: {
  label: string
  reduceMotion: boolean
  className?: string
  children: React.ReactNode
} & Omit<React.ComponentProps<typeof motion.button>, "children">) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <motion.button
            type="button"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon-xs" }),
              "relative size-5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              className
            )}
            aria-label={label}
            whileTap={reduceMotion ? undefined : { scale: 0.8 }}
            transition={actionTransition}
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function ProjectHeader({
  query,
  onQueryChange,
  projectsOpen,
  onProjectsOpenChange,
  projectListId,
}: {
  query: string
  onQueryChange: (query: string) => void
  projectsOpen: boolean
  onProjectsOpenChange: (open: boolean) => void
  projectListId: string
}) {
  const [isSearching, setIsSearching] = React.useState(false)
  const [sessionsExpanded, setSessionsExpanded] = React.useState(false)
  const [refreshAnimationKey, setRefreshAnimationKey] = React.useState(0)
  const [addAnimationKey, setAddAnimationKey] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const searchTriggerRef = React.useRef<HTMLButtonElement>(null)
  const restoreFocusRef = React.useRef(false)
  const searchIconLayoutId = React.useId()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const { t } = useTranslation()
  const transition: Transition = shouldReduceMotion
    ? { duration: 0 }
    : searchTransition

  React.useEffect(() => {
    if (isSearching) {
      inputRef.current?.focus()
      return
    }

    if (restoreFocusRef.current) {
      restoreFocusRef.current = false
      searchTriggerRef.current?.focus()
    }
  }, [isSearching])

  const closeSearch = (restoreFocus: boolean) => {
    restoreFocusRef.current = restoreFocus
    onQueryChange("")
    setIsSearching(false)
  }

  const openSearch = () => {
    onProjectsOpenChange(true)
    setIsSearching(true)
  }

  const projectsToggleLabel = projectsOpen
    ? t("sidebar.projects.collapseProjects")
    : t("sidebar.projects.expandProjects")
  const sessionsToggleLabel = sessionsExpanded
    ? t("sidebar.projects.collapseAllSessions")
    : t("sidebar.projects.expandAllSessions")

  return (
    <motion.div
      layout
      transition={transition}
      className="relative h-8 w-full"
    >
      <AnimatePresence initial={false} mode="popLayout">
        {isSearching ? (
          <motion.div
            key="input"
            layout
            className="absolute inset-0 z-[1]"
            initial={
              shouldReduceMotion
                ? false
                : { opacity: 0, scaleX: 0.94, y: -2 }
            }
            animate={{ opacity: 1, scaleX: 1, y: 0 }}
            exit={
              shouldReduceMotion
                ? { opacity: 0 }
                : { opacity: 0, scaleX: 0.96, y: -1 }
            }
            transition={transition}
            onBlurCapture={(event) => {
              const nextTarget = event.relatedTarget

              if (
                query ||
                (nextTarget instanceof Node &&
                  event.currentTarget.contains(nextTarget))
              ) {
                return
              }

              closeSearch(false)
            }}
          >
            <motion.span
              layoutId={searchIconLayoutId}
              className="pointer-events-none absolute top-1/2 left-2 z-10 flex -translate-y-1/2 text-sidebar-foreground/70"
              transition={transition}
            >
              <SearchIcon className="size-4" aria-hidden="true" />
            </motion.span>
            <SidebarInput
              ref={inputRef}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault()
                  closeSearch(true)
                }
              }}
              aria-label={t("sidebar.projects.search")}
              placeholder={t("sidebar.projects.searchPlaceholder")}
              className="border-0 bg-sidebar-accent pr-8 pl-8 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-sidebar-accent"
            />
            <ProjectHeaderAction
              label={t("sidebar.projects.clearSearch")}
              reduceMotion={shouldReduceMotion}
              className="absolute top-1/2 right-1 z-10 -translate-y-1/2 hover:bg-sidebar-accent"
              onClick={() => closeSearch(true)}
            >
              <XIcon className="size-3.5" aria-hidden="true" />
            </ProjectHeaderAction>
          </motion.div>
        ) : (
          <motion.div
            key="actions"
            layout
            className="absolute inset-0"
            initial={
              shouldReduceMotion
                ? false
                : { opacity: 0, scaleX: 0.96, y: 1 }
            }
            animate={{ opacity: 1, scaleX: 1, y: 0 }}
            exit={
              shouldReduceMotion
                ? { opacity: 0 }
                : { opacity: 0, scaleX: 0.94, y: 1 }
            }
            transition={transition}
          >
            <SidebarGroupLabel className="group/project-title w-full gap-0 pr-2">
              <motion.span
                className="shrink-0"
                initial={shouldReduceMotion ? false : { opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={transition}
              >
                {t("sidebar.groups.project")}
              </motion.span>

              <ProjectHeaderAction
                label={projectsToggleLabel}
                reduceMotion={shouldReduceMotion}
                className="pointer-events-none ml-[3px] opacity-0 transition-opacity duration-150 group-hover/project-title:pointer-events-auto group-hover/project-title:opacity-100 group-focus-within/project-title:pointer-events-auto group-focus-within/project-title:opacity-100 motion-reduce:transition-none"
                aria-controls={projectListId}
                aria-expanded={projectsOpen}
                onClick={() => onProjectsOpenChange(!projectsOpen)}
              >
                <ChevronRightIcon
                  className={cn(
                    "size-3.5 transition-transform duration-200",
                    projectsOpen && "rotate-90",
                    shouldReduceMotion && "transition-none"
                  )}
                  aria-hidden="true"
                />
              </ProjectHeaderAction>

              <div className="pointer-events-none ml-auto flex shrink-0 items-center gap-[10px] opacity-0 transition-opacity duration-150 group-hover/project-title:pointer-events-auto group-hover/project-title:opacity-100 group-focus-within/project-title:pointer-events-auto group-focus-within/project-title:opacity-100 motion-reduce:transition-none">
                <ProjectHeaderAction
                  label={sessionsToggleLabel}
                  reduceMotion={shouldReduceMotion}
                  aria-pressed={sessionsExpanded}
                  onClick={() => setSessionsExpanded((expanded) => !expanded)}
                >
                  <AnimatePresence initial={false} mode="wait">
                    <motion.span
                      key={sessionsExpanded ? "collapse" : "expand"}
                      className="flex"
                      initial={
                        shouldReduceMotion
                          ? false
                          : { opacity: 0, scale: 0.65 }
                      }
                      animate={{ opacity: 1, scale: 1 }}
                      exit={
                        shouldReduceMotion
                          ? { opacity: 0 }
                          : { opacity: 0, scale: 0.65 }
                      }
                      transition={transition}
                    >
                      {sessionsExpanded ? (
                        <Minimize2Icon
                          className="size-3.5"
                          aria-hidden="true"
                        />
                      ) : (
                        <Maximize2Icon
                          className="size-3.5"
                          aria-hidden="true"
                        />
                      )}
                    </motion.span>
                  </AnimatePresence>
                </ProjectHeaderAction>

                <ProjectHeaderAction
                  label={t("sidebar.projects.refreshSessions")}
                  reduceMotion={shouldReduceMotion}
                  onClick={() => setRefreshAnimationKey((key) => key + 1)}
                >
                  <motion.span
                    key={refreshAnimationKey}
                    className="flex"
                    initial={
                      refreshAnimationKey === 0 || shouldReduceMotion
                        ? false
                        : { rotate: 0 }
                    }
                    animate={{ rotate: refreshAnimationKey === 0 ? 0 : 360 }}
                    transition={{ duration: shouldReduceMotion ? 0 : 0.42 }}
                  >
                    <RefreshCwIcon
                      className="size-3.5"
                      aria-hidden="true"
                    />
                  </motion.span>
                </ProjectHeaderAction>

                <ProjectHeaderAction
                  ref={searchTriggerRef}
                  label={t("sidebar.projects.search")}
                  reduceMotion={shouldReduceMotion}
                  onClick={openSearch}
                >
                  <motion.span
                    layoutId={searchIconLayoutId}
                    className="flex"
                    transition={transition}
                  >
                    <SearchIcon
                      className="size-3.5"
                      aria-hidden="true"
                    />
                  </motion.span>
                </ProjectHeaderAction>

                <ProjectHeaderAction
                  label={t("sidebar.projects.addProject")}
                  reduceMotion={shouldReduceMotion}
                  onClick={() => setAddAnimationKey((key) => key + 1)}
                >
                  <motion.span
                    key={addAnimationKey}
                    className="flex"
                    initial={
                      addAnimationKey === 0 || shouldReduceMotion
                        ? false
                        : { scale: 0.7, rotate: -45 }
                    }
                    animate={{ scale: 1, rotate: 0 }}
                    transition={transition}
                  >
                    <PlusIcon className="size-3.5" aria-hidden="true" />
                  </motion.span>
                </ProjectHeaderAction>
              </div>
            </SidebarGroupLabel>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
