import * as React from "react"
import gsap from "gsap"
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Transition,
} from "motion/react"
import {
  ChevronDownIcon,
  FolderIcon,
  FolderPlusIcon,
  FolderSearchIcon,
  FoldersIcon,
  UploadIcon,
  XIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import {
  getFileBrowserChildFolders,
  type FileBrowserBreadcrumbEntry,
  type FileBrowserItem,
  type FileBrowserModel,
} from "../file-browser-data"

const goToTransition: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 34,
  mass: 0.75,
}

type VisibleBreadcrumbEntry =
  | { entry: FileBrowserBreadcrumbEntry; type: "item" }
  | { entries: FileBrowserBreadcrumbEntry[]; type: "collapsed" }

function getVisibleBreadcrumbEntries(
  path: FileBrowserBreadcrumbEntry[]
): VisibleBreadcrumbEntry[] {
  if (path.length <= 4) {
    return path.map((entry) => ({ entry, type: "item" }))
  }

  return [
    { entry: path[0], type: "item" },
    { entries: path.slice(1, -3), type: "collapsed" },
    ...path.slice(-3).map((entry) => ({ entry, type: "item" }) as const),
  ]
}

function CollapsedPathMenu({
  entries,
  onNavigate,
}: {
  entries: FileBrowserBreadcrumbEntry[]
  onNavigate: (path: string, type: FileBrowserItem["type"]) => void
}) {
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("fileBrowser.openCollapsedPath")}
          />
        }
      >
        <BreadcrumbEllipsis />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {entries.map((entry) => (
          <DropdownMenuItem
            key={entry.path}
            onClick={() => onNavigate(entry.path, entry.type)}
          >
            <FolderIcon aria-hidden="true" />
            {entry.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PathItem({
  current,
  entry,
  model,
  onNavigate,
}: {
  current: boolean
  entry: FileBrowserBreadcrumbEntry
  model: FileBrowserModel
  onNavigate: (path: string, type: FileBrowserItem["type"]) => void
}) {
  const { t } = useTranslation()
  const childFolders = getFileBrowserChildFolders(model, entry.path)
  const hasDirectoryOptions = childFolders.length > 1

  return (
    <div
      className="inline-flex min-w-0 items-center rounded-md"
      data-current={current || undefined}
    >
      <Button
        type="button"
        variant="ghost"
        size="xs"
        aria-current={current ? "location" : undefined}
        className="max-w-12 min-w-0 rounded-r-none px-1.5 text-sm font-normal data-[current=true]:bg-muted data-[current=true]:text-foreground sm:max-w-36"
        data-current={current || undefined}
        title={entry.path}
        onClick={() => onNavigate(entry.path, entry.type)}
      >
        <span className="truncate">{entry.name}</span>
      </Button>
      {hasDirectoryOptions && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="rounded-l-none"
                aria-label={t("fileBrowser.openDirectories", {
                  directory: entry.name,
                })}
              />
            }
          >
            <ChevronDownIcon aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {childFolders.map((childFolder) => (
              <DropdownMenuItem
                key={childFolder.path}
                onClick={() => onNavigate(childFolder.path, "folder")}
              >
                <FolderIcon aria-hidden="true" />
                {childFolder.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

function animateActionIcon(control: HTMLButtonElement) {
  const icon = control.querySelector("svg")

  if (
    !icon ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return
  }

  gsap.fromTo(
    icon,
    { scale: 0.78 },
    {
      scale: 1,
      duration: 0.28,
      ease: "back.out(2.5)",
      clearProps: "transform",
    }
  )
}

export function FileAddressBar({
  breadcrumb,
  currentDirectory,
  model,
  onCreateFolder,
  onGoTo,
  onNavigate,
  onTreeVisibilityChange,
  onUpload,
  treeVisible,
}: {
  breadcrumb: FileBrowserBreadcrumbEntry[]
  currentDirectory: string | null
  model: FileBrowserModel
  onCreateFolder: (directory: string) => void
  onGoTo: (path: string) => Promise<boolean>
  onNavigate: (path: string, type: FileBrowserItem["type"]) => void
  onTreeVisibilityChange: (visible: boolean) => void
  onUpload: (directory: string) => void
  treeVisible: boolean
}) {
  const { t } = useTranslation()
  const announcementTimerRef = React.useRef<number | null>(null)
  const goToInputRef = React.useRef<HTMLInputElement>(null)
  const goToTriggerRef = React.useRef<HTMLButtonElement>(null)
  const restoreGoToFocusRef = React.useRef(false)
  const [announcement, setAnnouncement] = React.useState("")
  const [goToPath, setGoToPath] = React.useState("")
  const [goToInvalid, setGoToInvalid] = React.useState(false)
  const [goToPending, setGoToPending] = React.useState(false)
  const [isGoingTo, setIsGoingTo] = React.useState(false)
  const goToIconLayoutId = React.useId()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const transition: Transition = shouldReduceMotion
    ? { duration: 0 }
    : goToTransition
  const entries = getVisibleBreadcrumbEntries(breadcrumb)
  const currentPath = breadcrumb.at(-1)?.path
  const treeToggleLabel = treeVisible
    ? t("fileBrowser.hideTree")
    : t("fileBrowser.showTree")

  React.useEffect(
    () => () => {
      if (announcementTimerRef.current !== null) {
        window.clearTimeout(announcementTimerRef.current)
      }
    },
    []
  )

  React.useEffect(() => {
    if (isGoingTo) {
      goToInputRef.current?.focus()
      return
    }

    if (restoreGoToFocusRef.current) {
      restoreGoToFocusRef.current = false
      goToTriggerRef.current?.focus()
    }
  }, [isGoingTo])

  const announce = React.useCallback((message: string) => {
    setAnnouncement(message)

    if (announcementTimerRef.current !== null) {
      window.clearTimeout(announcementTimerRef.current)
    }

    announcementTimerRef.current = window.setTimeout(
      () => setAnnouncement(""),
      1600
    )
  }, [])

  const closeGoTo = (restoreFocus: boolean) => {
    restoreGoToFocusRef.current = restoreFocus
    setGoToPath("")
    setGoToInvalid(false)
    setGoToPending(false)
    setIsGoingTo(false)
  }

  const navigateToDirectory = async () => {
    const path = goToPath.trim()
    if (!path || goToPending) {
      setGoToInvalid(true)
      return
    }

    setGoToPending(true)
    const found = await onGoTo(path)
    setGoToPending(false)

    if (!found) {
      setGoToInvalid(true)
      announce(t("fileBrowser.goToInvalidPath", { path }))
      return
    }

    closeGoTo(true)
  }

  return (
    <div
      data-file-browser-enter
      className="flex h-10 shrink-0 items-center gap-1 px-1"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={treeToggleLabel}
              aria-controls="file-browser-tree-pane"
              aria-expanded={treeVisible}
              aria-pressed={treeVisible}
              onClick={() => onTreeVisibilityChange(!treeVisible)}
            />
          }
        >
          <FoldersIcon aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>{treeToggleLabel}</TooltipContent>
      </Tooltip>
      <div className="relative h-8 min-w-0 flex-1">
        <motion.div
          layout
          className="absolute inset-0 flex min-w-0 items-center gap-0.5"
          transition={transition}
        >
          <Breadcrumb className="min-w-0 shrink overflow-hidden">
            <BreadcrumbList className="flex-nowrap gap-0 overflow-hidden text-sm sm:gap-0.5">
              {entries.map((entry, index) => (
                <React.Fragment
                  key={entry.type === "item" ? entry.entry.path : "collapsed"}
                >
                  {index > 0 && (
                    <BreadcrumbSeparator className="shrink-0" />
                  )}
                  <BreadcrumbItem className="min-w-0 shrink-0">
                    {entry.type === "collapsed" ? (
                      <CollapsedPathMenu
                        entries={entry.entries}
                        onNavigate={onNavigate}
                      />
                    ) : (
                      <PathItem
                        entry={entry.entry}
                        current={entry.entry.path === currentPath}
                        model={model}
                        onNavigate={onNavigate}
                      />
                    )}
                  </BreadcrumbItem>
                </React.Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>

          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={!currentDirectory}
                    aria-label={t("fileBrowser.createFolder")}
                    onClick={(event) => {
                      animateActionIcon(event.currentTarget)
                      if (currentDirectory) {
                        onCreateFolder(currentDirectory)
                      }
                    }}
                  />
                }
              >
                <FolderPlusIcon aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>{t("fileBrowser.createFolder")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={!currentDirectory}
                    aria-label={t("fileBrowser.upload")}
                    onClick={(event) => {
                      animateActionIcon(event.currentTarget)
                      if (currentDirectory) {
                        onUpload(currentDirectory)
                      }
                    }}
                  />
                }
              >
                <UploadIcon aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>{t("fileBrowser.upload")}</TooltipContent>
            </Tooltip>
          </div>

          <div aria-hidden="true" className="min-w-0 flex-1" />

          <AnimatePresence initial={false} mode="popLayout">
            {isGoingTo ? (
              <motion.form
                key="go-to-input"
                layout
                className="relative h-8 w-1/2 min-w-0 shrink-0 origin-right"
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
                onSubmit={(event) => {
                  event.preventDefault()
                  void navigateToDirectory()
                }}
                onBlurCapture={(event) => {
                  const nextTarget = event.relatedTarget

                  if (
                    goToPath ||
                    (nextTarget instanceof Node &&
                      event.currentTarget.contains(nextTarget))
                  ) {
                    return
                  }

                  closeGoTo(false)
                }}
              >
                <motion.span
                  layoutId={goToIconLayoutId}
                  className="pointer-events-none absolute top-1/2 left-2.5 z-10 flex -translate-y-1/2 text-muted-foreground"
                  transition={transition}
                >
                  <FolderSearchIcon className="size-4" aria-hidden="true" />
                </motion.span>
                <Input
                  ref={goToInputRef}
                  value={goToPath}
                  disabled={goToPending}
                  onChange={(event) => {
                    setGoToPath(event.target.value)
                    setGoToInvalid(false)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      void navigateToDirectory()
                      return
                    }

                    if (event.key === "Escape") {
                      event.preventDefault()
                      closeGoTo(true)
                    }
                  }}
                  aria-label={t("fileBrowser.goTo")}
                  aria-invalid={goToInvalid || undefined}
                  placeholder={t("fileBrowser.goToPlaceholder")}
                  className="h-8 border-0 bg-muted/60 pr-8 pl-8 text-xs shadow-none focus-visible:border-0 focus-visible:ring-0 aria-invalid:bg-destructive/10"
                />
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="absolute top-1/2 right-1 z-10 -translate-y-1/2"
                        aria-label={t("fileBrowser.closeGoTo")}
                        onClick={() => closeGoTo(true)}
                      />
                    }
                  >
                    <XIcon aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipContent>{t("fileBrowser.closeGoTo")}</TooltipContent>
                </Tooltip>
              </motion.form>
            ) : (
              <motion.div
                key="go-to-trigger"
                layout
                className="shrink-0"
                initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={
                  shouldReduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, scale: 0.9 }
                }
                transition={transition}
              >
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        ref={goToTriggerRef}
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("fileBrowser.goTo")}
                        onClick={() => setIsGoingTo(true)}
                      />
                    }
                  >
                    <motion.span
                      layoutId={goToIconLayoutId}
                      className="flex"
                      transition={transition}
                    >
                      <FolderSearchIcon aria-hidden="true" />
                    </motion.span>
                  </TooltipTrigger>
                  <TooltipContent>{t("fileBrowser.goTo")}</TooltipContent>
                </Tooltip>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  )
}
