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
import { FolderIcon, FolderOpenIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

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
  FILE_BROWSER_INITIAL_EXPANDED_ITEMS,
  FILE_BROWSER_ROOT_ID,
  fileBrowserItems,
  getFileBrowserPath,
  type FileBrowserItem,
} from "../file-browser-data"
import { FileTypeIcon } from "./file-type-icon"

const FILE_TREE_INDENT = 20

function FileBrowserTreeNode({
  item,
  level,
}: {
  item: ItemInstance<FileBrowserItem>
  level: number
}) {
  const data = item.getItemData()
  const treeItem = (
    <TreeItem
      item={item}
      level={level}
      className="relative w-full pb-0! text-start"
    >
      <TreeItemLabel className="min-h-8 w-full gap-2">
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
      </TreeItemLabel>
    </TreeItem>
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
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function FileBrowserTree({
  onItemSelect,
  query,
  selectedItemId,
}: {
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
      className="min-w-max gap-0.5"
    >
      {tree.getRootItem().getChildren().map((item) => (
        <FileBrowserTreeNode key={item.getId()} item={item} level={0} />
      ))}
    </Tree>
  )
}
