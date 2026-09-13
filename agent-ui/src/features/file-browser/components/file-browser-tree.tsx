import * as React from "react"
import {
  expandAllFeature,
  hotkeysCoreFeature,
  propMemoizationFeature,
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
import { cn } from "@/lib/utils"

import {
  FILE_BROWSER_ROOT_ID,
  getFileBrowserAncestorPaths,
  isSameOrDescendantPath,
  type FileBrowserItem,
  type FileBrowserModel,
} from "../file-browser-data"
import {
  createFileTreeRevisions,
  type FileTreeRevisions,
} from "../file-tree-revisions"
import { FileTreeFolderIcon } from "./file-tree-folder-icon"
import { FileTreeItemMenu } from "./file-tree-item-menu"
import { FileTypeIcon } from "./file-type-icon"
import { TooltipHint } from "@/components/ui/tooltip"

const FILE_TREE_INDENT = 20
const FILE_TREE_ROW_HEIGHT = 26
const FILE_TREE_PANEL_TRANSITION_MS = 200
const fileTreeRowVisibilityStyle = {
  contentVisibility: "auto",
  containIntrinsicSize: `auto ${FILE_TREE_ROW_HEIGHT}px`,
} satisfies React.CSSProperties

function resolveFileTreeHighlightElement(item: HTMLElement) {
  return item.querySelector<HTMLElement>(
    '[data-slot="tree-item-label"]'
  )
}

function useClipUntilOpenTransitionEnds(open: boolean) {
  const [clipContents, setClipContents] = React.useState(!open)

  React.useEffect(() => {
    if (!open) {
      setClipContents(true)
      return
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setClipContents(false)
      return
    }

    const timeoutId = window.setTimeout(() => {
      setClipContents(false)
    }, FILE_TREE_PANEL_TRANSITION_MS)

    return () => window.clearTimeout(timeoutId)
  }, [open])

  return clipContents
}

type FileBrowserTreeActions = {
  onActionFeedback: (message: string) => void
  onDeleteRequest?: (item: FileBrowserItem) => void
  onDownload?: (item: FileBrowserItem) => void
  onUpload?: (directory: string) => void
}

const FileBrowserTreeRow = React.memo(function FileBrowserTreeRow({
  compact,
  data,
  expanded,
  focused,
  item,
  icon,
  metadata,
  hideToggle,
  level,
  loading,
  positionInSet,
  searchMatch,
  selected,
  setSize,
  onActionFeedback,
  onDeleteRequest,
  onDownload,
  onUpload,
}: FileBrowserTreeActions & {
  compact: boolean
  data: FileBrowserItem
  expanded: boolean
  focused: boolean
  item: ItemInstance<FileBrowserItem>
  icon?: React.ReactNode
  metadata?: React.ReactNode
  hideToggle?: boolean
  level: number
  loading: boolean
  positionInSet: number
  searchMatch: boolean
  selected: boolean
  setSize: number
}) {
  const { i18n } = useTranslation()
  const isFolder = data.type === "folder"
  const [nameMarqueeActive, setNameMarqueeActive] = React.useState(false)
  const modifiedDate =
    compact || !data.modifiedAt
      ? null
      : new Date(data.modifiedAt * 1000)
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

  const treeItemButton = (
    <TreeItem
      item={item}
      level={level}
      aria-busy={loading || undefined}
      aria-posinset={positionInSet}
      aria-setsize={setSize}
      data-focus={focused}
      data-selected={selected}
      data-search-match={searchMatch}
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
              top: `${level * FILE_TREE_ROW_HEIGHT}px`,
              zIndex: 50 - level,
            }
          : fileTreeRowVisibilityStyle
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
      <TreeItemLabel showToggle={!hideToggle} className="relative z-[1] min-h-6.5 w-full min-w-0 max-w-full gap-1 bg-transparent! py-0.75 pe-5 hover:bg-transparent! in-data-[selected=true]:bg-accent! in-data-[stuck=true]:bg-accent! in-data-[stuck=true]:hover:bg-accent! in-data-popup-open:bg-accent!">
        <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          {icon ?? (isFolder ? (
            <FileTreeFolderIcon expanded={expanded} />
          ) : (
            <FileTypeIcon name={data.name} path={data.path} />
          ))}
          <span
            data-file-tree-name=""
            data-file-tree-name-text={data.name}
            className="min-w-0 flex-1"
          >
            <OverflowMarquee
              active={nameMarqueeActive}
              playback="once"
              className="min-w-0 w-full"
            >
              {data.name}
            </OverflowMarquee>
          </span>
          {loading && (
            <LoaderCircleIcon className="size-3 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
          )}
        </span>
        {metadata !== undefined ? metadata : compact ? (
          <span className="w-[clamp(2.25rem,15cqi,3rem)] shrink-0 overflow-hidden text-right text-[10px] leading-none whitespace-nowrap tabular-nums text-muted-foreground">
            {size}
          </span>
        ) : (
          <span className="flex min-w-0 shrink-0 items-center gap-[clamp(0.25rem,2cqi,0.75rem)] overflow-hidden">
            <span className="w-[clamp(2.25rem,15cqi,3rem)] shrink-0 overflow-hidden text-right text-[10px] leading-none whitespace-nowrap tabular-nums text-muted-foreground">
              {size}
            </span>
            <TooltipHint content={fullModifiedAt}>
              <time
                dateTime={modifiedDate?.toISOString()}
                className="w-[clamp(3rem,22cqi,4rem)] shrink-0 overflow-hidden text-right text-[10px] leading-none whitespace-nowrap tabular-nums text-muted-foreground"
              >
                {modifiedAt}
              </time>
            </TooltipHint>
          </span>
        )}
      </TreeItemLabel>
    </TreeItem>
  )
  if (!onDeleteRequest || !onDownload || !onUpload) return treeItemButton

  return (
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
})

function FileBrowserTreePanel({
  children,
  level,
  open,
}: {
  children: React.ReactNode
  level: number
  open: boolean
}) {
  // Finishing the height transition only updates the panel, not every row.
  const clipContents = useClipUntilOpenTransitionEnds(open)

  return (
    <CollapsibleContent
      keepMounted
      role="group"
      className={cn(
        "h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out starting:h-0 data-[ending-style]:h-0 data-[starting-style]:h-0 motion-reduce:transition-none",
        // Sticky nested folders need overflow:visible once open. During the
        // height animation it would paint children over still-collapsed rows.
        open && !clipContents && "overflow-visible"
      )}
    >
      <div
        className="relative flex w-full min-w-0 max-w-full flex-col gap-px pt-px before:pointer-events-none before:absolute before:inset-y-0 before:start-[var(--file-tree-line-offset)] before:w-px before:bg-border"
        style={
          {
            "--file-tree-line-offset": `${(level + 1) * FILE_TREE_INDENT - 5}px`,
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </CollapsibleContent>
  )
}

// Shared per-tree data that nodes read at render time. It travels through a
// ref so that replacing the loading set does not invalidate every memoized
// node; the revision tracker bumps exactly the nodes whose loading changed.
type FileBrowserTreeShared = {
  loadingDirectories: ReadonlySet<string>
  revisions: FileTreeRevisions
}

// Item instances are stable per id but mutable, so the node is memoized on
// `revision`, which the tree bumps for an item and its ancestors whenever
// their state, children or loading flag changes.
const FileBrowserTreeNode = React.memo(function FileBrowserTreeNode({
  compact,
  item,
  level,
  loading,
  positionInSet,
  setSize,
  shared,
  onActionFeedback,
  onDeleteRequest,
  onDownload,
  onUpload,
  onFolderExpand,
  rootIcon,
  rootMetadata,
  hideRootToggle,
}: FileBrowserTreeActions & {
  compact: boolean
  item: ItemInstance<FileBrowserItem>
  level: number
  loading: boolean
  positionInSet: number
  /** Only compared by React.memo; bumping it is what re-renders the node. */
  revision: number
  setSize: number
  shared: React.RefObject<FileBrowserTreeShared>
  onFolderExpand?: (path: string) => void
  rootIcon?: React.ReactNode
  rootMetadata?: React.ReactNode
  hideRootToggle?: boolean
}) {
  const data = item.getItemData()
  const isFolder = item.isFolder()
  const children = isFolder ? item.getChildren() : []
  const expanded = item.isExpanded()
  const { loadingDirectories, revisions } = shared.current
  // Wait for the first directory listing so the panel measures its real height.
  const panelOpen = expanded && (children.length > 0 || !loading)
  const canStick = isFolder && expanded && children.length > 0
  const stickySentinelRef = React.useRef<HTMLSpanElement>(null)
  const stickyEndSentinelRef = React.useRef<HTMLSpanElement>(null)

  React.useEffect(() => {
    if (isFolder && expanded) onFolderExpand?.(data.path)
  }, [data.path, expanded, isFolder, onFolderExpand])

  React.useEffect(() => {
    const sentinel = stickySentinelRef.current
    const endSentinel = stickyEndSentinelRef.current
    const row = sentinel?.parentElement?.querySelector<HTMLButtonElement>(
      ':scope > [data-file-tree-folder-row="true"]'
    )
    const scrollContainer = sentinel?.closest<HTMLElement>(
      "[data-file-tree-scroll]"
    )

    if (
      !isFolder ||
      !sentinel ||
      !endSentinel ||
      !row ||
      !scrollContainer
    ) {
      return
    }

    row.dataset.stuck = "false"
    if (!canStick || typeof IntersectionObserver === "undefined") return

    let isStuck = false
    let startAboveBoundary = false
    let endAboveBoundary = false

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const stickyBoundary =
            entry.rootBounds?.top ??
            scrollContainer.getBoundingClientRect().top +
              level * FILE_TREE_ROW_HEIGHT
          const aboveBoundary =
            !entry.isIntersecting &&
            entry.boundingClientRect.top < stickyBoundary
          if (entry.target === sentinel) startAboveBoundary = aboveBoundary
          if (entry.target === endSentinel) endAboveBoundary = aboveBoundary
        }

        // Crossing the top alone also catches ordinary rows scrolling away.
        // A sticky row must still have enough subtree below it to stay pinned.
        const nextIsStuck = startAboveBoundary && !endAboveBoundary

        if (nextIsStuck === isStuck) {
          return
        }

        isStuck = nextIsStuck
        row.dataset.stuck = String(nextIsStuck)
      },
      {
        root: scrollContainer,
        rootMargin: `-${level * FILE_TREE_ROW_HEIGHT}px 0px 0px 0px`,
        threshold: 0,
      }
    )

    observer.observe(sentinel)
    observer.observe(endSentinel)

    return () => {
      observer.disconnect()
      delete row.dataset.stuck
    }
  }, [canStick, isFolder, level])

  // ItemInstance is mutable. Pass current primitive state into the memoized
  // row so selection, keyboard focus, search and sibling metadata stay fresh.
  // Sibling positions come from the directory, since Headless Tree resets
  // metadata for hidden descendants while their closing animation still runs.
  const treeItem = (
    <FileBrowserTreeRow
      compact={compact}
      data={data}
      expanded={expanded}
      focused={item.isFocused()}
      item={item}
      icon={level === 0 ? rootIcon : undefined}
      metadata={level === 0 ? rootMetadata : undefined}
      hideToggle={level === 0 && hideRootToggle}
      level={level}
      loading={loading}
      positionInSet={positionInSet}
      searchMatch={item.isMatchingSearch()}
      selected={item.isSelected()}
      setSize={setSize}
      onActionFeedback={onActionFeedback}
      onDeleteRequest={onDeleteRequest}
      onDownload={onDownload}
      onUpload={onUpload}
    />
  )

  if (!isFolder) {
    return treeItem
  }

  return (
    <Collapsible
      open={panelOpen}
      role="none"
      className="relative flex w-full min-w-0 max-w-full flex-col"
    >
      <span
        ref={stickySentinelRef}
        aria-hidden="true"
        className="pointer-events-none -mb-px block h-px w-full"
      />
      {treeItem}
      <FileBrowserTreePanel open={panelOpen} level={level}>
        {children.map((child, index) => {
          const childId = child.getId()
          return (
            <FileBrowserTreeNode
              key={childId}
              compact={compact}
              item={child}
              level={level + 1}
              loading={child.isFolder() && loadingDirectories.has(childId)}
              positionInSet={index + 1}
              revision={revisions.get(childId)}
              setSize={children.length}
              shared={shared}
              onActionFeedback={onActionFeedback}
              onDeleteRequest={onDeleteRequest}
              onDownload={onDownload}
              onUpload={onUpload}
              onFolderExpand={onFolderExpand}
            />
          )
        })}
      </FileBrowserTreePanel>
      <span
        ref={stickyEndSentinelRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 h-px"
        style={{ bottom: FILE_TREE_ROW_HEIGHT }}
      />
    </Collapsible>
  )
})

export function FileBrowserTree({
  compact = false,
  defaultExpanded = true,
  loadingDirectories,
  model,
  onActionFeedback,
  onDeleteRequest,
  onDownload,
  onItemSelect,
  onUpload,
  onVisibleRowsChange,
  onFolderExpand,
  query,
  rootPath,
  selectedItemPath,
  rootIcon,
  rootMetadata,
  hideRootToggle,
}: {
  compact?: boolean
  defaultExpanded?: boolean
  loadingDirectories: Set<string>
  model: FileBrowserModel
  onActionFeedback: (message: string) => void
  onDeleteRequest?: (item: FileBrowserItem) => void
  onDownload?: (item: FileBrowserItem) => void
  onItemSelect: (
    path: string,
    shouldLoadDirectory: boolean
  ) => Promise<void>
  onUpload?: (directory: string) => void
  onVisibleRowsChange?: () => void
  onFolderExpand?: (path: string) => void
  query: string
  rootPath: string
  selectedItemPath: string | null
  rootIcon?: React.ReactNode
  rootMetadata?: React.ReactNode
  hideRootToggle?: boolean
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
      expandedItems: defaultExpanded ? [rootPath] : [],
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
      propMemoizationFeature,
    ],
  })

  const treeState = tree.getState()
  const expandedKey = treeState.expandedItems.join("\n")

  // Revision bookkeeping is derived from the same inputs as this render and
  // is idempotent per input set, so it runs inline rather than in an effect
  // that would need a second render to propagate.
  const revisionsRef = React.useRef<FileTreeRevisions>(null)
  revisionsRef.current ??= createFileTreeRevisions()
  const revisions = revisionsRef.current
  revisions.update({
    expandedItems: treeState.expandedItems,
    selectedItems: treeState.selectedItems,
    focusedItem: treeState.focusedItem,
    search: treeState.search,
    loadingDirectories,
    model,
    rootPath,
  })
  const sharedRef = React.useRef<FileBrowserTreeShared>({
    loadingDirectories,
    revisions,
  })
  sharedRef.current = { loadingDirectories, revisions }

  React.useLayoutEffect(() => {
    tree.rebuildTree()
  }, [model, rootPath, tree])

  React.useLayoutEffect(() => {
    onVisibleRowsChange?.()
  }, [expandedKey, loadingDirectories, model, onVisibleRowsChange, query])

  React.useEffect(() => {
    if (
      !selectedItemPath ||
      !model.items[selectedItemPath] ||
      !isSameOrDescendantPath(selectedItemPath, rootPath)
    ) {
      if (tree.getState().selectedItems.length > 0) {
        tree.setSelectedItems([])
      }
      return
    }

    const selectedItems = tree.getState().selectedItems
    if (selectedItems.length !== 1 || selectedItems[0] !== selectedItemPath) {
      tree.setSelectedItems([selectedItemPath])
    }

    getFileBrowserAncestorPaths(
      model.items,
      selectedItemPath,
      rootPath
    )
      .filter((path) => Boolean(model.items[path]))
      .forEach((path) => {
        const ancestor = tree.getItemInstance(path)
        if (!ancestor.isExpanded()) {
          ancestor.expand()
        }
      })

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
        className="w-full min-w-0 max-w-full gap-px overflow-x-clip"
      >
        {tree.getRootItem().getChildren().map((item) => (
          <FileBrowserTreeNode
            key={item.getId()}
            compact={compact}
            item={item}
            level={0}
            loading={loadingDirectories.has(item.getId())}
            positionInSet={1}
            revision={revisions.get(item.getId())}
            setSize={1}
            shared={sharedRef}
            onActionFeedback={onActionFeedback}
            onDeleteRequest={onDeleteRequest}
            onDownload={onDownload}
            onUpload={onUpload}
            onFolderExpand={onFolderExpand}
            rootIcon={rootIcon}
            rootMetadata={rootMetadata}
            hideRootToggle={hideRootToggle}
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
