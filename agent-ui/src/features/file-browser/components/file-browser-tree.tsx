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
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
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
  const shouldReduceMotion = Boolean(useReducedMotion())
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
      className="relative min-w-max gap-0.5 before:absolute before:inset-0 before:-ms-1 before:bg-[repeating-linear-gradient(to_right,transparent_0,transparent_calc(var(--tree-indent)-1px),var(--border)_calc(var(--tree-indent)-1px),var(--border)_calc(var(--tree-indent)))]"
    >
      <AnimatePresence initial={false}>
        {tree.getItems().map((item) => {
          const data = item.getItemData()

          return (
            <TreeItem
              key={item.getId()}
              item={item}
              className="w-full overflow-hidden text-start"
              render={
                <motion.button
                  initial={
                    shouldReduceMotion
                      ? false
                      : { height: 0, opacity: 0 }
                  }
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={
                    shouldReduceMotion
                      ? { duration: 0 }
                      : { duration: 0.2, ease: "easeOut" }
                  }
                />
              }
            >
              <TreeItemLabel className="relative min-h-8 w-full gap-2 before:absolute before:inset-x-0 before:-inset-y-0.5 before:-z-10 before:bg-background">
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
      </AnimatePresence>
    </Tree>
  )
}
