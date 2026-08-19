import * as React from "react"
import { ChevronDownIcon } from "lucide-react"
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import {
  getFileBrowserChildFolders,
  type FileBrowserBreadcrumbEntry,
  type FileBrowserItem,
  type FileBrowserModel,
} from "../file-browser-data"
import { SearchablePathMenuContent } from "./searchable-path-menu"

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
  const [open, setOpen] = React.useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
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
      <SearchablePathMenuContent
        entries={entries}
        open={open}
        onNavigate={onNavigate}
      />
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
  const [directoryMenuOpen, setDirectoryMenuOpen] = React.useState(false)
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
        <DropdownMenu
          open={directoryMenuOpen}
          onOpenChange={setDirectoryMenuOpen}
        >
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
          <SearchablePathMenuContent
            entries={childFolders}
            open={directoryMenuOpen}
            onNavigate={onNavigate}
          />
        </DropdownMenu>
      )}
    </div>
  )
}

export function FilePathBreadcrumb({
  breadcrumb,
  model,
  onNavigate,
}: {
  breadcrumb: FileBrowserBreadcrumbEntry[]
  model: FileBrowserModel
  onNavigate: (path: string, type: FileBrowserItem["type"]) => void
}) {
  const entries = getVisibleBreadcrumbEntries(breadcrumb)
  const currentPath = breadcrumb.at(-1)?.path

  return (
    <Breadcrumb className="min-w-0 shrink overflow-hidden">
      <BreadcrumbList className="flex-nowrap gap-0 overflow-hidden text-sm sm:gap-0.5">
        {entries.map((entry, index) => (
          <React.Fragment
            key={entry.type === "item" ? entry.entry.path : "collapsed"}
          >
            {index > 0 && <BreadcrumbSeparator className="shrink-0" />}
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
  )
}
