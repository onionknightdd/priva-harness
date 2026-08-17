import * as React from "react"
import {
  expandAllFeature,
  hotkeysCoreFeature,
  searchFeature,
  selectionFeature,
  syncDataLoaderFeature,
} from "@headless-tree/core"
import { useTree } from "@headless-tree/react"
import { FolderIcon, FolderOpenIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

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
      indent={20}
      aria-label={t("fileBrowser.treeLabel")}
      className="min-w-max gap-0.5"
    >
      {tree.getItems().map((item) => {
        const data = item.getItemData()

        return (
          <TreeItem
            key={item.getId()}
            item={item}
            className="w-full text-start"
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
      })}
    </Tree>
  )
}
