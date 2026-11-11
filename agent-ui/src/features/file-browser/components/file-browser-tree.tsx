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
  fileTreeToggle,
  flattenFileTree,
  type FileTreeRow,
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
const FILE_TREE_REVEAL_MS = 200
// Enough rows to fill the tallest tree surface while a block slides past.
const FILE_TREE_REVEAL_ROWS = 60

// A folder opening or closing. The rows keep their final places in the list;
// `--file-tree-reveal` runs between 0 and `distance` and the rows derive
// their mask or offset from it, while `--file-tree-reveal-progress` runs
// between 0 and 1 for the width of the fade at the moving edge, so the motion
// costs no React work per frame.
type FileTreeReveal = {
  kind: "open" | "close"
  /** Bottom edge of the row above the block, in list coordinates. */
  seam: number
  distance: number
  first: number
  count: number
  /** The rows that just left, kept on screen while they are covered. */
  leaving: FileTreeRow<ItemInstance<FileBrowserItem>>[]
}

// The mask of a row whose top is `offset` px below the seam: opaque above the
// moving edge, transparent below it, with a gradient along the direction in
// which the block opens.
function fileTreeRevealMask(offset: number): React.CSSProperties {
  const edge = `calc(var(--file-tree-reveal) - ${offset}px)`
  const fade = `calc(${FILE_TREE_ROW_HEIGHT}px * (1 - var(--file-tree-reveal-progress)))`
  const mask = `linear-gradient(to bottom, #000 calc(${edge} - ${fade}), transparent ${edge})`
  return { maskImage: mask, WebkitMaskImage: mask }
}

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
  revealRole,
  revealSeam,
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
  /**
   * While a folder opens or closes: "covered" rows are its children, masked
   * at the moving edge; "pushed" and "pulled" rows follow that edge, below a
   * block that is opening or closing; "leaving" rows are covered children
   * that are already gone from the tree.
   */
  revealRole: "covered" | "leaving" | "pushed" | "pulled" | null
  revealSeam: number
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
      data-reveal={revealRole ?? undefined}
      aria-hidden={revealRole === "leaving" || undefined}
      inert={revealRole === "leaving" || undefined}
      className="box-border w-full min-w-0 max-w-full rounded-none pb-0! text-start data-[stuck=true]:bg-card"
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
              ...(revealRole === "covered" || revealRole === "leaving"
                ? {
                    // Hidden below the edge at `seam + reveal`, and fading
                    // towards it. The fade is as tall as a row when the block
                    // is closed and narrows to a hard edge once it is open.
                    ...fileTreeRevealMask(
                      index * FILE_TREE_ROW_PITCH - revealSeam
                    ),
                    pointerEvents:
                      revealRole === "leaving" ? "none" : undefined,
                  }
                : revealRole === "pushed"
                  ? {
                      translate:
                        "0 calc(var(--file-tree-reveal) - var(--file-tree-reveal-distance))",
                    }
                  : revealRole === "pulled"
                    ? { translate: "0 var(--file-tree-reveal)" }
                    : null),
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

  // Opening or closing a folder inserts or removes one block of rows. Compare
  // the lists during render so the motion starts with the commit that changes
  // them; any other change (search, a refresh) is applied without motion.
  const [previousRows, setPreviousRows] = React.useState(rows)
  const [reveal, setReveal] = React.useState<FileTreeReveal | null>(null)
  if (previousRows !== rows) {
    const toggle = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? null
      : fileTreeToggle(previousRows, rows, (item) => item.getId())
    setPreviousRows(rows)
    setReveal(
      toggle && {
        ...toggle,
        seam: toggle.first * FILE_TREE_ROW_PITCH,
        distance: toggle.count * FILE_TREE_ROW_PITCH,
        leaving:
          toggle.kind === "close"
            ? previousRows.slice(
                toggle.first,
                toggle.first + Math.min(toggle.count, FILE_TREE_REVEAL_ROWS)
              )
            : [],
      }
    )
  }
  React.useLayoutEffect(() => {
    const container = containerRef.current
    if (!reveal) return
    if (!container || typeof container.animate !== "function") {
      setReveal(null)
      return
    }
    const closed = "0px"
    const open = `${reveal.distance}px`
    const animation = container.animate(
      {
        "--file-tree-reveal":
          reveal.kind === "open" ? [closed, open] : [open, closed],
        "--file-tree-reveal-progress": reveal.kind === "open" ? [0, 1] : [1, 0],
      } as PropertyIndexedKeyframes,
      { duration: FILE_TREE_REVEAL_MS, easing: "ease-out", fill: "both" }
    )
    animation.finished.then(
      () => setReveal((current) => (current === reveal ? null : current)),
      () => undefined
    )
    return () => animation.cancel()
  }, [reveal])

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
      // The rows a large folder pushes out start right below it, so they stay
      // mounted until they have left, wherever the list now puts them.
      ...(reveal?.kind === "open"
        ? Array.from(
            { length: FILE_TREE_REVEAL_ROWS },
            (_, offset) => reveal.first + reveal.count + offset
          ).filter((index) => index < rows.length)
        : []),
    ]),
  ].sort((left, right) => left - right)
  const renderedRows = renderedIndexes.flatMap((index) => {
    const pinnedShift = pinnedShiftByIndex.get(index) ?? null
    const entry = {
      row: rows[index],
      index,
      pinnedShift,
      revealRole:
        !reveal || pinnedShift !== null || index < reveal.first
          ? null
          : reveal.kind === "close"
            ? ("pulled" as const)
            : index < reveal.first + reveal.count
              ? ("covered" as const)
              : ("pushed" as const),
    }
    // Leaving rows keep their old places, between the folder and the rows
    // that follow it, so no mounted row changes its order in the DOM.
    return reveal?.kind === "close" && index === reveal.first
      ? [
          ...reveal.leaving.map((row, offset) => ({
            row,
            index: reveal.first + offset,
            pinnedShift: null,
            revealRole: "leaving" as const,
          })),
          entry,
        ]
      : [entry]
  })
  // Closing the last folder of the list leaves no row to carry the leaving ones.
  if (reveal?.kind === "close" && reveal.first >= rows.length) {
    renderedRows.push(
      ...reveal.leaving.map((row, offset) => ({
        row,
        index: reveal.first + offset,
        pinnedShift: null,
        revealRole: "leaving" as const,
      }))
    )
  }

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
          style={
            {
              // A closing block keeps its room until it has been covered, so
              // the scroll position is not clamped under the moving rows.
              height: Math.max(
                0,
                rows.length * FILE_TREE_ROW_PITCH -
                  1 +
                  (reveal?.kind === "close" ? reveal.distance : 0)
              ),
              "--file-tree-reveal-distance": `${reveal?.distance ?? 0}px`,
            } as React.CSSProperties
          }
        >
        {renderedRows.map(({ row, index, pinnedShift, revealRole }) => {
          const item = row.node
          const id = item.getId()
          const root = row.level === 0
          return (
            <FileBrowserTreeRow
              key={id}
              compact={compact}
              data={item.getItemData()}
              expanded={item.isExpanded()}
              focused={item.isFocused()}
              index={index}
              item={item}
              icon={root ? rootIcon : undefined}
              metadata={root ? rootMetadata : undefined}
              hideToggle={root && hideRootToggle}
              level={row.level}
              loading={item.isFolder() && loadingDirectories.has(id)}
              pinnedShift={pinnedShift}
              positionInSet={row.positionInSet}
              revealRole={revealRole}
              revealSeam={reveal?.seam ?? 0}
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
