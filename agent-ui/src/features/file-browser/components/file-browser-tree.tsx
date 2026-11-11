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
import { useVirtualizer } from "@tanstack/react-virtual"
import { LoaderCircleIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { OverflowMarquee } from "@/components/motion/overflow-marquee"
import { MenuItemHighlight } from "@/components/motion/sidebar-menu-highlight"
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
import {
  FILE_TREE_ROW_HEIGHT,
  FILE_TREE_ROW_PITCH,
  fileTreeRevealOffset,
  flattenFileTree,
  pinnedFileTreeRows,
} from "../file-tree-rows"
import { FileTreeFolderIcon } from "./file-tree-folder-icon"
import { FileTreeItemMenu } from "./file-tree-item-menu"
import { FileTypeIcon } from "./file-type-icon"
import { FileGitStatus } from "./file-git-status"
import { TooltipHint } from "@/components/ui/tooltip"

const FILE_TREE_INDENT = 20
// Rows rendered beyond each edge of the viewport, so a fast scroll and the
// next arrow-key target are already mounted.
const FILE_TREE_OVERSCAN = 12
const FILE_TREE_ENTER_MS = 200

function resolveFileTreeHighlightElement(item: HTMLElement) {
  return item.querySelector<HTMLElement>(
    '[data-slot="tree-item-label"]'
  )
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
  entering,
  expanded,
  focused,
  index,
  item,
  icon,
  metadata,
  hideToggle,
  level,
  loading,
  pinnedShift,
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
  /** Revealed by an expansion just now, as opposed to scrolled into view. */
  entering: boolean
  expanded: boolean
  focused: boolean
  /** Position in the flat list of visible rows. */
  index: number
  item: ItemInstance<FileBrowserItem>
  icon?: React.ReactNode
  metadata?: React.ReactNode
  hideToggle?: boolean
  level: number
  loading: boolean
  /**
   * null for a row at its place in the list. A number for an ancestor held
   * at the top of the viewport: 0 at rest, negative while the end of its
   * subtree pushes it out.
   */
  pinnedShift: number | null
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
      data-stuck={isFolder ? pinnedShift === 0 : undefined}
      data-entering={entering || undefined}
      className="box-border w-full min-w-0 max-w-full rounded-none pb-0! text-start data-[stuck=true]:bg-card data-[entering=true]:animate-file-tree-row-enter motion-reduce:animate-none"
      onPointerEnter={() => setNameMarqueeActive(true)}
      onPointerLeave={() => setNameMarqueeActive(false)}
      onFocusCapture={() => setNameMarqueeActive(true)}
      onBlurCapture={() => setNameMarqueeActive(false)}
      style={
        pinnedShift === null
          ? {
              position: "absolute",
              insetInlineStart: 0,
              top: index * FILE_TREE_ROW_PITCH,
            }
          : {
              // Pinned rows are the only rows in flow. Each sits at the top
              // of the list and gives its height back, so `sticky` holds it
              // in its slot on the compositor while the list scrolls.
              position: "sticky",
              top: level * FILE_TREE_ROW_HEIGHT,
              marginBottom: -FILE_TREE_ROW_HEIGHT,
              zIndex: 50 - level,
              transform: pinnedShift
                ? `translateY(${pinnedShift}px)`
                : undefined,
            }
      }
    >
      {Array.from({ length: level }, (_, lineIndex) => (
          <span
            key={lineIndex}
            aria-hidden="true"
            data-slot="file-tree-indent-line"
            // One guide per ancestor level, bridging the 1px gap to the next
            // row so the guides read as continuous lines.
            className="pointer-events-none absolute top-0 -bottom-px w-px bg-border"
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
        <FileGitStatus path={data.path} />
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
  const containerRef = React.useRef<HTMLDivElement>(null)
  const revealRowRef = React.useRef<(itemId: string) => void>(() => undefined)
  const tree = useTree<FileBrowserItem>({
    // Keyboard focus can move to a row outside the rendered window.
    scrollToItem: (item) => revealRowRef.current(item.getId()),
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

  // Item instances are stable but mutable: the flat list only depends on which
  // folders are open and what the directories contain.
  const rows = React.useMemo(
    () => {
      void expandedKey
      void model
      return flattenFileTree(tree.getRootItem().getChildren(), {
        isFolder: (item) => item.isFolder(),
        isExpanded: (item) => item.isExpanded(),
        getChildren: (item) => item.getChildren(),
      })
    },
    [expandedKey, model, tree]
  )
  const rowIndexById = React.useMemo(
    () => new Map(rows.map((row, index) => [row.node.getId(), index])),
    [rows]
  )

  // Rows revealed by an expansion fade in; rows that merely scroll into the
  // window must not, so the set only lives for the length of the animation.
  const [previousRows, setPreviousRows] = React.useState(rows)
  const [enteringIds, setEnteringIds] =
    React.useState<ReadonlySet<string> | null>(null)
  if (previousRows !== rows) {
    const known = new Set(previousRows.map((row) => row.node.getId()))
    const added = rows
      .map((row) => row.node.getId())
      .filter((id) => !known.has(id))
    setPreviousRows(rows)
    setEnteringIds(added.length > 0 ? new Set(added) : null)
  }
  React.useEffect(() => {
    if (!enteringIds) return
    const timeoutId = window.setTimeout(
      () => setEnteringIds(null),
      FILE_TREE_ENTER_MS
    )
    return () => window.clearTimeout(timeoutId)
  }, [enteringIds])

  // The tree lives in a scroll surface owned by its host, possibly below other
  // content. `scrollMargin` is the list's offset inside that surface.
  const [scrollElement, setScrollElement] = React.useState<HTMLElement | null>(
    null
  )
  const [scrollMargin, setScrollMargin] = React.useState(0)
  React.useLayoutEffect(() => {
    const container = containerRef.current
    const scroller =
      container?.closest<HTMLElement>("[data-file-tree-scroll]") ?? null
    setScrollElement(scroller)
    if (!container || !scroller) return

    const measure = () => {
      const margin = Math.round(
        container.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          scroller.clientTop +
          scroller.scrollTop
      )
      setScrollMargin((current) => (current === margin ? current : margin))
    }
    measure()
    // Content above the list can grow or shrink without the list resizing.
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    for (const child of scroller.children) observer.observe(child)
    scroller.addEventListener("scroll", measure, { passive: true })
    return () => {
      observer.disconnect()
      scroller.removeEventListener("scroll", measure)
    }
  }, [rows.length])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => FILE_TREE_ROW_PITCH,
    overscan: FILE_TREE_OVERSCAN,
    scrollMargin,
  })
  const listOffset = (virtualizer.scrollOffset ?? 0) - scrollMargin
  const pinned = pinnedFileTreeRows(rows, listOffset)
  const pinnedShiftByIndex = new Map(
    pinned.map((entry) => [entry.index, entry.shift])
  )
  // Without a scroll surface there is no window to compute: render every row.
  const windowIndexes = scrollElement
    ? virtualizer.getVirtualItems().map((entry) => entry.index)
    : rows.map((_, index) => index)
  const focusedIndex = treeState.focusedItem
    ? rowIndexById.get(treeState.focusedItem)
    : undefined
  // Ascending order keeps every mounted row at a stable place among its
  // siblings: a row never moves in the DOM when it is pinned or released, so
  // it keeps its focus and hover state. Pinned ancestors precede the window.
  const renderedIndexes = [
    ...new Set([
      ...pinned.map((entry) => entry.index),
      ...(focusedIndex === undefined ? [] : [focusedIndex]),
      ...windowIndexes,
    ]),
  ].sort((left, right) => left - right)

  revealRowRef.current = (itemId) => {
    const index = rowIndexById.get(itemId)
    if (index === undefined || !scrollElement) return
    const offset = fileTreeRevealOffset(
      { index, level: rows[index].level },
      scrollElement.scrollTop - scrollMargin,
      scrollElement.clientHeight
    )
    if (offset !== null) scrollElement.scrollTop = offset + scrollMargin
  }

  // A folder reports its expansion once, when it first shows as open, and
  // again only after it has been closed.
  const reportedExpansionsRef = React.useRef(new Set<string>())
  React.useEffect(() => {
    const reported = reportedExpansionsRef.current
    const expandedIds = new Set(treeState.expandedItems)
    for (const id of reported) {
      if (!expandedIds.has(id)) reported.delete(id)
    }
    for (const row of rows) {
      const id = row.node.getId()
      if (row.node.isFolder() && expandedIds.has(id) && !reported.has(id)) {
        reported.add(id)
        onFolderExpand?.(id)
      }
    }
  }, [onFolderExpand, rows, treeState.expandedItems])

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

    // The ancestors expanded above reach the flat list on the next render.
    const frame = window.requestAnimationFrame(() => {
      revealRowRef.current(selectedItemPath)
    })
    return () => window.cancelAnimationFrame(frame)
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
        className="block w-full min-w-0 max-w-full overflow-x-clip"
      >
        {/* Pinned rows stack in this box's normal flow; every other row is
            positioned inside it. Its height is that of the whole list. */}
        <div
          ref={containerRef}
          role="presentation"
          className="relative"
          style={{
            height: Math.max(0, rows.length * FILE_TREE_ROW_PITCH - 1),
          }}
        >
        {renderedIndexes.map((index) => {
          const row = rows[index]
          const item = row.node
          const id = item.getId()
          const root = row.level === 0
          return (
            <FileBrowserTreeRow
              key={id}
              compact={compact}
              data={item.getItemData()}
              entering={enteringIds?.has(id) ?? false}
              expanded={item.isExpanded()}
              focused={item.isFocused()}
              index={index}
              item={item}
              icon={root ? rootIcon : undefined}
              metadata={root ? rootMetadata : undefined}
              hideToggle={root && hideRootToggle}
              level={row.level}
              loading={item.isFolder() && loadingDirectories.has(id)}
              pinnedShift={pinnedShiftByIndex.get(index) ?? null}
              positionInSet={row.positionInSet}
              searchMatch={item.isMatchingSearch()}
              selected={item.isSelected()}
              setSize={row.setSize}
              onActionFeedback={onActionFeedback}
              onDeleteRequest={onDeleteRequest}
              onDownload={onDownload}
              onUpload={onUpload}
            />
          )
        })}
        </div>
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
