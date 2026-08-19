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
import { LoaderCircleIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { OverflowMarquee } from "@/components/motion/overflow-marquee"
import { MenuItemHighlight } from "@/components/motion/sidebar-menu-highlight"
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import {
  Tree,
  TreeItem,
  TreeItemLabel,
} from "@/components/reui/tree"

import {
  FILE_BROWSER_ROOT_ID,
  getFileBrowserAncestorPaths,
  isSameOrDescendantPath,
  type FileBrowserItem,
  type FileBrowserModel,
} from "../file-browser-data"
import { FileTreeFolderIcon } from "./file-tree-folder-icon"
import { FileTreeItemMenu } from "./file-tree-item-menu"
import { FileTypeIcon } from "./file-type-icon"

const FILE_TREE_INDENT = 20
const FILE_TREE_STICKY_ROW_HEIGHT = 32

function resolveFileTreeHighlightElement(item: HTMLElement) {
  return item.querySelector<HTMLElement>(
    '[data-slot="tree-item-label"]'
  )
}

function FileBrowserTreeNode({
  item,
  level,
  loadingDirectories,
  onActionFeedback,
  onDeleteRequest,
  onDownload,
  onUpload,
}: {
  item: ItemInstance<FileBrowserItem>
  level: number
  loadingDirectories: Set<string>
  onActionFeedback: (message: string) => void
  onDeleteRequest: (item: FileBrowserItem) => void
  onDownload: (item: FileBrowserItem) => void
  onUpload: (directory: string) => void
}) {
  const { i18n } = useTranslation()
  const data = item.getItemData()
  const isFolder = item.isFolder()
  const loading = isFolder && loadingDirectories.has(data.path)
  const stickySentinelRef = React.useRef<HTMLSpanElement>(null)
  const [nameMarqueeActive, setNameMarqueeActive] =
    React.useState(false)
  const modifiedDate = data.modifiedAt
    ? new Date(data.modifiedAt * 1000)
    : null
  const modifiedAt = modifiedDate
    ? new Intl.DateTimeFormat(i18n.resolvedLanguage, {
        day: "2-digit",
        hour: "2-digit",
        hour12: false,
        minute: "2-digit",
        month: "2-digit",
      }).format(modifiedDate)
    : ""
  const fullModifiedAt = modifiedDate
    ? new Intl.DateTimeFormat(i18n.resolvedLanguage, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(modifiedDate)
    : undefined
  const size =
    data.type === "file" && data.size !== null
      ? formatFileSize(data.size, i18n.resolvedLanguage)
      : ""

  React.useEffect(() => {
    const sentinel = stickySentinelRef.current
    const row = sentinel?.parentElement?.querySelector<HTMLButtonElement>(
      ':scope > [data-file-tree-folder-row="true"]'
    )
    const scrollContainer = sentinel?.closest<HTMLElement>(
      "[data-file-tree-scroll]"
    )

    if (
      !isFolder ||
      !sentinel ||
      !row ||
      !scrollContainer ||
      typeof IntersectionObserver === "undefined"
    ) {
      return
    }

    let isStuck = false
    row.dataset.stuck = "false"

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) {
          return
        }

        const stickyBoundary =
          entry.rootBounds?.top ??
          scrollContainer.getBoundingClientRect().top +
            level * FILE_TREE_STICKY_ROW_HEIGHT
        const nextIsStuck =
          !entry.isIntersecting &&
          entry.boundingClientRect.top < stickyBoundary

        if (nextIsStuck === isStuck) {
          return
        }

        isStuck = nextIsStuck
        row.dataset.stuck = String(nextIsStuck)
      },
      {
        root: scrollContainer,
        rootMargin: `-${level * FILE_TREE_STICKY_ROW_HEIGHT}px 0px 0px 0px`,
        threshold: 0,
      }
    )

    observer.observe(sentinel)

    return () => {
      observer.disconnect()
      delete row.dataset.stuck
    }
  }, [isFolder, level])

  const treeItemButton = (
    <TreeItem
      item={item}
      level={level}
      aria-busy={loading || undefined}
      data-file-tree-item-id={item.getId()}
      data-file-tree-folder-row={isFolder || undefined}
      className="relative box-border w-full min-w-0 max-w-full rounded-none pb-0! text-start data-[file-tree-folder-row=true]:sticky data-[stuck=true]:bg-card"
      onPointerEnter={() => setNameMarqueeActive(true)}
      onPointerLeave={() => setNameMarqueeActive(false)}
      onFocusCapture={() => setNameMarqueeActive(true)}
      onBlurCapture={() => setNameMarqueeActive(false)}
      style={
        isFolder
          ? {
              top: `${level * FILE_TREE_STICKY_ROW_HEIGHT}px`,
              zIndex: 50 - level,
            }
          : undefined
      }
    >
      {isFolder &&
        Array.from({ length: level }, (_, lineIndex) => (
          <span
            key={lineIndex}
            aria-hidden="true"
            data-slot="file-tree-sticky-indent-line"
            className="pointer-events-none absolute inset-y-0 z-[1] hidden w-px bg-border in-data-[stuck=true]:block"
            style={{
              left: `${(lineIndex + 1) * FILE_TREE_INDENT - 5}px`,
            }}
          />
        ))}
      <TreeItemLabel className="relative z-[1] min-h-8 w-full min-w-0 max-w-full gap-1 bg-transparent! pe-5 hover:bg-transparent! in-data-[selected=true]:bg-accent! in-data-[stuck=true]:hover:bg-accent! in-data-popup-open:bg-accent!">
        <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          {isFolder ? (
            <FileTreeFolderIcon expanded={item.isExpanded()} />
          ) : (
            <FileTypeIcon name={data.name} path={data.path} />
          )}
          <OverflowMarquee
            active={nameMarqueeActive}
            playback="once"
            className="min-w-0 flex-1"
          >
            {data.name}
          </OverflowMarquee>
          {loading && (
            <LoaderCircleIcon className="size-3 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
          )}
        </span>
        <span className="flex min-w-0 shrink-0 items-center gap-[clamp(0.25rem,2cqi,0.75rem)] overflow-hidden">
          <span className="w-[clamp(2.25rem,15cqi,3rem)] shrink-0 overflow-hidden text-right text-[10px] leading-none whitespace-nowrap tabular-nums text-muted-foreground">
            {size}
          </span>
          <time
            dateTime={modifiedDate?.toISOString()}
            title={fullModifiedAt}
            className="w-[clamp(3rem,22cqi,4rem)] shrink-0 overflow-hidden text-right text-[10px] leading-none whitespace-nowrap tabular-nums text-muted-foreground"
          >
            {modifiedAt}
          </time>
        </span>
      </TreeItemLabel>
    </TreeItem>
  )
  const treeItem = (
    <FileTreeItemMenu
      item={data}
      onActionFeedback={onActionFeedback}
      onDeleteRequest={onDeleteRequest}
      onDownload={onDownload}
      onUpload={onUpload}
    >
      {treeItemButton}
    </FileTreeItemMenu>
  )

  if (!isFolder) {
    return treeItem
  }

  return (
    <Collapsible
      open={item.isExpanded()}
      role="none"
      className="flex w-full min-w-0 max-w-full flex-col"
    >
      <span
        ref={stickySentinelRef}
        aria-hidden="true"
        className="pointer-events-none -mb-px block h-px w-full"
      />
      {treeItem}
      <CollapsibleContent
        role="group"
        className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height,opacity] duration-200 ease-out data-open:overflow-visible data-[ending-style]:h-0 data-[ending-style]:overflow-hidden data-[ending-style]:opacity-0 data-[starting-style]:h-0 data-[starting-style]:overflow-hidden data-[starting-style]:opacity-0 motion-reduce:transition-none"
      >
        <div
          className="relative flex w-full min-w-0 max-w-full flex-col gap-0.5 pt-0.5 before:pointer-events-none before:absolute before:inset-y-0 before:start-[var(--file-tree-line-offset)] before:w-px before:bg-border"
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
              loadingDirectories={loadingDirectories}
              onActionFeedback={onActionFeedback}
              onDeleteRequest={onDeleteRequest}
              onDownload={onDownload}
              onUpload={onUpload}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function FileBrowserTree({
  loadingDirectories,
  model,
  onActionFeedback,
  onDeleteRequest,
  onDownload,
  onItemSelect,
  onUpload,
  query,
  rootPath,
  selectedItemPath,
}: {
  loadingDirectories: Set<string>
  model: FileBrowserModel
  onActionFeedback: (message: string) => void
  onDeleteRequest: (item: FileBrowserItem) => void
  onDownload: (item: FileBrowserItem) => void
  onItemSelect: (
    path: string,
    shouldLoadDirectory: boolean
  ) => Promise<void>
  onUpload: (directory: string) => void
  query: string
  rootPath: string
  selectedItemPath: string | null
}) {
  const { t } = useTranslation()
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const hasMatches = Object.values(model.items).some(
    (item) =>
      item.path !== FILE_BROWSER_ROOT_ID &&
      isSameOrDescendantPath(item.path, rootPath) &&
      item.name.toLocaleLowerCase().includes(normalizedQuery)
  )
  const tree = useTree<FileBrowserItem>({
    initialState: {
      expandedItems: [rootPath],
      selectedItems: selectedItemPath ? [selectedItemPath] : [],
    },
    rootItemId: FILE_BROWSER_ROOT_ID,
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData().type === "folder",
    dataLoader: {
      getItem: (itemId) => model.items[itemId],
      getChildren: (itemId) =>
        itemId === FILE_BROWSER_ROOT_ID
          ? [rootPath]
          : model.childrenByPath[itemId] ?? [],
    },
    onPrimaryAction: (item) => {
      const shouldLoadDirectory = item.isFolder() && !item.isExpanded()

      void onItemSelect(item.getId(), shouldLoadDirectory).catch(
        (error: unknown) =>
          onActionFeedback(
            error instanceof Error ? error.message : String(error)
          )
        )
    },
    features: [
      syncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      searchFeature,
      expandAllFeature,
    ],
  })

  React.useLayoutEffect(() => {
    tree.rebuildTree()
  }, [model, rootPath, tree])

  React.useEffect(() => {
    if (
      !selectedItemPath ||
      !model.items[selectedItemPath] ||
      !isSameOrDescendantPath(selectedItemPath, rootPath)
    ) {
      tree.setSelectedItems([])
      return
    }

    tree.setSelectedItems([selectedItemPath])

    getFileBrowserAncestorPaths(
      model.items,
      selectedItemPath,
      rootPath
    )
      .filter((path) => Boolean(model.items[path]))
      .forEach((path) => tree.getItemInstance(path).expand())

    const selectedItem = tree.getItemInstance(selectedItemPath)

    window.requestAnimationFrame(() => {
      void selectedItem.scrollTo({ block: "nearest" })
    })
  }, [model, rootPath, selectedItemPath, tree])

  React.useEffect(() => {
    if (normalizedQuery) {
      tree.setSearch(normalizedQuery)
      void tree.expandAll()
      return
    }

    tree.setSearch(null)
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
    <MenuItemHighlight
      className="w-full min-w-0 max-w-full"
      highlightClassName="z-[5] bg-accent"
      highlightSlot="file-tree-hover-highlight"
      itemSelector="[data-file-tree-item-id]"
      resolveHighlightElement={resolveFileTreeHighlightElement}
    >
      <Tree
        tree={tree}
        indent={FILE_TREE_INDENT}
        aria-label={t("fileBrowser.treeLabel")}
        className="w-full min-w-0 max-w-full gap-0.5 overflow-x-clip"
      >
        {tree.getRootItem().getChildren().map((item) => (
          <FileBrowserTreeNode
            key={item.getId()}
            item={item}
            level={0}
            loadingDirectories={loadingDirectories}
            onActionFeedback={onActionFeedback}
            onDeleteRequest={onDeleteRequest}
            onDownload={onDownload}
            onUpload={onUpload}
          />
        ))}
      </Tree>
    </MenuItemHighlight>
  )
}

function formatFileSize(bytes: number, language?: string) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  const units = ["KB", "MB", "GB", "TB"]
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
