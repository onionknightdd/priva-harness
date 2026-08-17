import * as React from "react"
import {
  ChevronDownIcon,
  FolderIcon,
  FoldersIcon,
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
      className="inline-flex min-w-0 items-center rounded-md bg-muted/40"
      data-current={current || undefined}
    >
      <Button
        type="button"
        variant="ghost"
        size="xs"
        aria-current={current ? "location" : undefined}
        className="max-w-12 min-w-0 rounded-r-none px-1.5 font-normal data-[current=true]:text-foreground sm:max-w-36 sm:px-2"
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
                className="rounded-l-none border-l border-border/60"
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
  const path = getFileBrowserPath(selectedItemId)
  const entries = getBreadcrumbEntries(path)
  const treeToggleLabel = treeVisible
    ? t("fileBrowser.hideTree")
    : t("fileBrowser.showTree")

  return (
    <div className="flex h-11 shrink-0 items-center gap-1.5 border-b px-2">
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
    </div>
  )
}
