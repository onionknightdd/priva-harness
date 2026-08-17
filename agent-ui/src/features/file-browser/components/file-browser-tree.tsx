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
      className="relative w-full text-start before:pointer-events-none before:absolute before:-inset-y-0.5 before:start-0 before:-ms-1 before:w-[var(--tree-padding)] before:bg-[repeating-linear-gradient(to_right,transparent_0,transparent_calc(var(--tree-indent)-1px),var(--border)_calc(var(--tree-indent)-1px),var(--border)_calc(var(--tree-indent)))]"
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
        className="flex h-[var(--collapsible-panel-height)] flex-col gap-0.5 overflow-hidden pt-0.5 transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0 motion-reduce:transition-none"
      >
        {item.getChildren().map((child) => (
          <FileBrowserTreeNode
            key={child.getId()}
            item={child}
            level={level + 1}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function FileBrowserTree({ query }: { query: string }) {
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
      selectedItems: [],
    },
    rootItemId: FILE_BROWSER_ROOT_ID,
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData().type === "folder",
    dataLoader: {
      getItem: (itemId) => fileBrowserItems[itemId],
      getChildren: (itemId) => fileBrowserItems[itemId].children ?? [],
    },
    features: [
      syncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      searchFeature,
      expandAllFeature,
    ],
  })

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
