import * as React from "react"
import {
  expandAllFeature,
  hotkeysCoreFeature,
  searchFeature,
  selectionFeature,
  syncDataLoaderFeature,
  type ItemInstance,
} from "@headless-tree/core"
import { useTree } from "@headless-tree/react"
import {
  CopyIcon,
  DownloadIcon,
  FolderIcon,
  FolderOpenIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Tree,
  TreeItem,
  TreeItemLabel,
} from "@/components/reui/tree"
import { writeClipboardText } from "@/lib/clipboard"

import {
  FILE_BROWSER_INITIAL_EXPANDED_ITEMS,
  FILE_BROWSER_ROOT_ID,
  fileBrowserItems,
  fileBrowserItemMetadata,
  getFileBrowserPath,
  type FileBrowserItem,
} from "../file-browser-data"
import { FileTypeIcon } from "./file-type-icon"

const FILE_TREE_INDENT = 20

function FileBrowserTreeNode({
  item,
  level,
  onActionFeedback,
}: {
  item: ItemInstance<FileBrowserItem>
  level: number
  onActionFeedback: (message: string) => void
}) {
  const { i18n, t } = useTranslation()
  const data = item.getItemData()
  const metadata = fileBrowserItemMetadata[item.getId()]
  const itemPath = getFileBrowserPath(item.getId())
    .map((itemId) => fileBrowserItems[itemId].name)
    .join("/")
  const modifiedAt = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(metadata.modifiedAt))
  const fullModifiedAt = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(metadata.modifiedAt))
  const size = metadata.size
    ? formatFileSize(metadata.size, i18n.resolvedLanguage)
    : ""
  const treeItemButton = (
    <TreeItem
      item={item}
      level={level}
      className="relative w-full pb-0! text-start"
    >
      <TreeItemLabel className="min-h-8 w-full min-w-0 gap-1.5 pr-1 in-data-popup-open:bg-accent">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {item.isFolder() ? (
            item.isExpanded() ? (
              <FolderOpenIcon className="size-4 text-muted-foreground" />
            ) : (
              <FolderIcon className="size-4 text-muted-foreground" />
            )
          ) : (
            <FileTypeIcon name={data.name} />
          )}
          <span className="truncate">{data.name}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="w-12 shrink-0 text-right text-[10px] leading-none tabular-nums text-muted-foreground">
            {size}
          </span>
          <time
            dateTime={metadata.modifiedAt}
            title={fullModifiedAt}
            className="w-16 shrink-0 text-right text-[10px] leading-none tabular-nums text-muted-foreground"
          >
            {modifiedAt}
          </time>
        </span>
      </TreeItemLabel>
    </TreeItem>
  )
  const treeItem = (
    <ContextMenu>
      <ContextMenuTrigger render={treeItemButton} />
      <ContextMenuContent>
        <ContextMenuItem
          onClick={() => {
            void writeClipboardText(itemPath)
              .then(() =>
                onActionFeedback(
                  t("fileBrowser.pathCopied", { path: itemPath })
                )
              )
              .catch(() =>
                onActionFeedback(t("fileBrowser.copyPathFailed"))
              )
          }}
        >
          <CopyIcon aria-hidden="true" />
          {t("fileBrowser.contextMenu.copyPath")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() =>
            onActionFeedback(
              t("fileBrowser.actionUnavailable", {
                action: t("fileBrowser.contextMenu.download"),
              })
            )
          }
        >
          <DownloadIcon aria-hidden="true" />
          {t("fileBrowser.contextMenu.download")}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() =>
            onActionFeedback(
              t("fileBrowser.actionUnavailable", {
                action: t("fileBrowser.contextMenu.uploadHere"),
              })
            )
          }
        >
          <UploadIcon aria-hidden="true" />
          {t("fileBrowser.contextMenu.uploadHere")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onClick={() =>
            onActionFeedback(
              t("fileBrowser.actionUnavailable", {
                action: t("fileBrowser.contextMenu.delete"),
              })
            )
          }
        >
          <Trash2Icon aria-hidden="true" />
          {t("fileBrowser.contextMenu.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )

  if (!item.isFolder()) {
    return treeItem
  }

  return (
    <Collapsible
      open={item.isExpanded()}
      role="none"
      className="flex flex-col"
    >
      {treeItem}
      <CollapsibleContent
        role="group"
        className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height,opacity] duration-200 ease-out data-[ending-style]:h-0 data-[ending-style]:opacity-0 data-[starting-style]:h-0 data-[starting-style]:opacity-0 motion-reduce:transition-none"
      >
        <div
          className="relative flex flex-col gap-0.5 pt-0.5 before:pointer-events-none before:absolute before:inset-y-0 before:start-[var(--file-tree-line-offset)] before:w-px before:bg-border"
          style={
            {
              "--file-tree-line-offset": `${(level + 1) * FILE_TREE_INDENT - 5}px`,
            } as React.CSSProperties
          }
        >
          {item.getChildren().map((child) => (
            <FileBrowserTreeNode
              key={child.getId()}
              item={child}
              level={level + 1}
              onActionFeedback={onActionFeedback}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function FileBrowserTree({
  onActionFeedback,
  onItemSelect,
  query,
  selectedItemId,
}: {
  onActionFeedback: (message: string) => void
  onItemSelect: (itemId: string) => void
  query: string
  selectedItemId: string
}) {
  const { t } = useTranslation()
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const hasMatches = Object.entries(fileBrowserItems).some(
    ([itemId, item]) =>
      itemId !== FILE_BROWSER_ROOT_ID &&
      item.name.toLocaleLowerCase().includes(normalizedQuery)
  )
  const tree = useTree<FileBrowserItem>({
    initialState: {
      expandedItems: FILE_BROWSER_INITIAL_EXPANDED_ITEMS,
      selectedItems: [selectedItemId],
    },
    rootItemId: FILE_BROWSER_ROOT_ID,
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData().type === "folder",
    dataLoader: {
      getItem: (itemId) => fileBrowserItems[itemId],
      getChildren: (itemId) => fileBrowserItems[itemId].children ?? [],
    },
    onPrimaryAction: (item) => onItemSelect(item.getId()),
    features: [
      syncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      searchFeature,
      expandAllFeature,
    ],
  })

  React.useEffect(() => {
    tree.setSelectedItems([selectedItemId])

    getFileBrowserPath(selectedItemId)
      .slice(0, -1)
      .forEach((itemId) => {
        tree.getItemInstance(itemId).expand()
      })

    const selectedItem = tree.getItemInstance(selectedItemId)
    if (selectedItem.isFolder()) {
      selectedItem.expand()
    }

    window.requestAnimationFrame(() => {
      void selectedItem.scrollTo({ block: "nearest" })
    })
  }, [selectedItemId, tree])

  React.useEffect(() => {
    if (normalizedQuery) {
      tree.setSearch(normalizedQuery)
      void tree.expandAll()
      return
    }

    tree.setSearch(null)
    tree.collapseAll()
    FILE_BROWSER_INITIAL_EXPANDED_ITEMS.forEach((itemId) => {
      tree.getItemInstance(itemId).expand()
    })
  }, [normalizedQuery, tree])

  if (normalizedQuery && !hasMatches) {
    return (
      <div
        role="status"
        className="flex min-h-48 items-center justify-center px-6 text-center text-sm text-muted-foreground"
      >
        {t("fileBrowser.noResults", { query: query.trim() })}
      </div>
    )
  }

  return (
    <Tree
      tree={tree}
      indent={FILE_TREE_INDENT}
      aria-label={t("fileBrowser.treeLabel")}
      className="w-full min-w-0 gap-0.5"
    >
      {tree.getRootItem().getChildren().map((item) => (
        <FileBrowserTreeNode
          key={item.getId()}
          item={item}
          level={0}
          onActionFeedback={onActionFeedback}
        />
      ))}
    </Tree>
  )
}

function formatFileSize(bytes: number, language?: string) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  const units = ["KB", "MB", "GB"]
  let value = bytes / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${new Intl.NumberFormat(language, {
    maximumFractionDigits: 1,
  }).format(value)} ${units[unitIndex]}`
}
