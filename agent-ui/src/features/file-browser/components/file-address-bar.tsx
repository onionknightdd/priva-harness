import * as React from "react"
import gsap from "gsap"
import {
  ChevronDownIcon,
  FolderIcon,
  FolderPlusIcon,
  FoldersIcon,
  UploadIcon,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import {
  fileBrowserItems,
  getFileBrowserChildFolderIds,
  getFileBrowserPath,
} from "../file-browser-data"

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
        className="max-w-12 min-w-0 rounded-r-none px-1.5 font-normal data-[current=true]:bg-muted data-[current=true]:text-foreground sm:max-w-36 sm:px-2"
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
  const [announcement, setAnnouncement] = React.useState("")
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

  const handlePlaceholderAction = (
    event: React.MouseEvent<HTMLButtonElement>,
    action: string
  ) => {
    const icon = event.currentTarget.querySelector("svg")

    setAnnouncement(t("fileBrowser.actionUnavailable", { action }))

    if (announcementTimerRef.current !== null) {
      window.clearTimeout(announcementTimerRef.current)
    }

    announcementTimerRef.current = window.setTimeout(
      () => setAnnouncement(""),
      1600
    )

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
      <Breadcrumb className="min-w-0 flex-1 overflow-hidden">
        <BreadcrumbList className="flex-nowrap gap-0 overflow-hidden text-xs sm:gap-1.5">
          {entries.map((entry, index) => (
            <React.Fragment
              key={entry.type === "item" ? entry.id : "collapsed"}
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
          <TooltipContent>{t("fileBrowser.createFolder")}</TooltipContent>
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
                  handlePlaceholderAction(event, t("fileBrowser.upload"))
                }
              />
            }
          >
            <UploadIcon aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>{t("fileBrowser.upload")}</TooltipContent>
        </Tooltip>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  )
}
