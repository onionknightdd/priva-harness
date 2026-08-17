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
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import {
  fileBrowserItems,
  findFileBrowserFolderIdByPath,
  getFileBrowserChildFolderIds,
  getFileBrowserPath,
} from "../file-browser-data"

const goToTransition: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 34,
  mass: 0.75,
}

type BreadcrumbEntry =
  | { id: string; type: "item" }
  | { ids: string[]; type: "collapsed" }

function getBreadcrumbEntries(path: string[]): BreadcrumbEntry[] {
  if (path.length <= 4) {
    return path.map((id) => ({ id, type: "item" }))
  }

  return [
    { id: path[0], type: "item" },
    { ids: path.slice(1, -3), type: "collapsed" },
    ...path.slice(-3).map((id) => ({ id, type: "item" }) as const),
  ]
}

function CollapsedPathMenu({
  itemIds,
  onNavigate,
}: {
  itemIds: string[]
  onNavigate: (itemId: string) => void
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
        {itemIds.map((itemId) => (
          <DropdownMenuItem
            key={itemId}
            onClick={() => onNavigate(itemId)}
          >
            <FolderIcon aria-hidden="true" />
            {fileBrowserItems[itemId].name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PathItem({
  current,
  itemId,
  onNavigate,
}: {
  current: boolean
  itemId: string
  onNavigate: (itemId: string) => void
}) {
  const { t } = useTranslation()
  const item = fileBrowserItems[itemId]
  const childFolderIds = getFileBrowserChildFolderIds(itemId)
  const hasDirectoryOptions = childFolderIds.length > 1

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
        className="max-w-12 min-w-0 rounded-r-none px-1.5 text-sm font-normal data-[current=true]:bg-muted data-[current=true]:text-foreground sm:max-w-36 sm:px-2"
        data-current={current || undefined}
        title={item.name}
        onClick={() => onNavigate(itemId)}
      >
        <span className="truncate">{item.name}</span>
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
                  directory: item.name,
                })}
              />
            }
          >
            <ChevronDownIcon aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {childFolderIds.map((childId) => (
              <DropdownMenuItem
                key={childId}
                onClick={() => onNavigate(childId)}
              >
                <FolderIcon aria-hidden="true" />
                {fileBrowserItems[childId].name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

export function FileAddressBar({
  onNavigate,
  onTreeVisibilityChange,
  selectedItemId,
  treeVisible,
}: {
  onNavigate: (itemId: string) => void
  onTreeVisibilityChange: (visible: boolean) => void
  selectedItemId: string
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
  const [isGoingTo, setIsGoingTo] = React.useState(false)
  const goToIconLayoutId = React.useId()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const transition: Transition = shouldReduceMotion
    ? { duration: 0 }
    : goToTransition
  const path = getFileBrowserPath(selectedItemId)
  const entries = getBreadcrumbEntries(path)
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
    setIsGoingTo(false)
  }

  const navigateToDirectory = () => {
    const directoryId = findFileBrowserFolderIdByPath(goToPath)

    if (!directoryId || !goToPath.trim()) {
      setGoToInvalid(true)
      announce(t("fileBrowser.goToInvalidPath", { path: goToPath }))
      return
    }

    onNavigate(directoryId)
    closeGoTo(true)
  }

  const handleGoTo = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    navigateToDirectory()
  }

  const handlePlaceholderAction = (
    event: React.MouseEvent<HTMLButtonElement>,
    action: string
  ) => {
    const icon = event.currentTarget.querySelector("svg")

    announce(t("fileBrowser.actionUnavailable", { action }))

    if (
      icon &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
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
  }

  return (
    <div
      data-file-browser-enter
      className="flex h-10 shrink-0 items-center gap-1.5 px-1"
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
        <AnimatePresence initial={false} mode="popLayout">
          {isGoingTo ? (
            <motion.form
              key="go-to-input"
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
              onSubmit={handleGoTo}
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
                <FolderSearchIcon
                  className="size-4"
                  aria-hidden="true"
                />
              </motion.span>
              <Input
                ref={goToInputRef}
                value={goToPath}
                onChange={(event) => {
                  setGoToPath(event.target.value)
                  setGoToInvalid(false)
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    navigateToDirectory()
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
                <TooltipContent>
                  {t("fileBrowser.closeGoTo")}
                </TooltipContent>
              </Tooltip>
            </motion.form>
          ) : (
            <motion.div
              key="address-actions"
              layout
              className="absolute inset-0 flex min-w-0 items-center gap-1"
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
              <Breadcrumb className="min-w-0 shrink overflow-hidden">
                <BreadcrumbList className="flex-nowrap gap-0 overflow-hidden text-sm sm:gap-1.5">
                  {entries.map((entry, index) => (
                    <React.Fragment
                      key={
                        entry.type === "item"
                          ? entry.id
                          : "collapsed"
                      }
                    >
                      {index > 0 && (
                        <BreadcrumbSeparator className="shrink-0" />
                      )}
                      <BreadcrumbItem className="min-w-0 shrink-0">
                        {entry.type === "collapsed" ? (
                          <CollapsedPathMenu
                            itemIds={entry.ids}
                            onNavigate={onNavigate}
                          />
                        ) : (
                          <PathItem
                            itemId={entry.id}
                            current={entry.id === selectedItemId}
                            onNavigate={onNavigate}
                          />
                        )}
                      </BreadcrumbItem>
                    </React.Fragment>
                  ))}
                </BreadcrumbList>
              </Breadcrumb>

              <div className="flex shrink-0 items-center gap-1">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("fileBrowser.createFolder")}
                        onClick={(event) =>
                          handlePlaceholderAction(
                            event,
                            t("fileBrowser.createFolder")
                          )
                        }
                      />
                    }
                  >
                    <FolderPlusIcon aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("fileBrowser.createFolder")}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("fileBrowser.upload")}
                        onClick={(event) =>
                          handlePlaceholderAction(
                            event,
                            t("fileBrowser.upload")
                          )
                        }
                      />
                    }
                  >
                    <UploadIcon aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("fileBrowser.upload")}
                  </TooltipContent>
                </Tooltip>
              </div>

              <div aria-hidden="true" className="min-w-0 flex-1" />

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
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  )
}
