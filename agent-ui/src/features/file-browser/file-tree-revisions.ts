import {
  getFileBrowserAncestorPaths,
  type FileBrowserItem,
  type FileBrowserModel,
} from "./file-browser-data"

export type FileTreeRevisionInputs = {
  expandedItems: readonly string[]
  selectedItems: readonly string[]
  focusedItem: string | null
  search: string | null
  loadingDirectories: ReadonlySet<string>
  model: FileBrowserModel
  rootPath: string
}

// Headless Tree keeps row state (expanded, selected, focused, search) on
// mutable item instances, so a memoized row cannot see those changes through
// its props. The tracker diffs the tree inputs between renders and bumps a
// revision for every item whose own state, directory contents or loading
// state changed, plus its ancestors so the change propagates through memoized
// parents. Rows with an unchanged revision skip rendering entirely.
export function createFileTreeRevisions() {
  const revisions = new Map<string, number>()
  let base = 0
  let previous: FileTreeRevisionInputs | null = null

  function bump(
    path: string,
    items: Record<string, FileBrowserItem>,
    fallbackItems: Record<string, FileBrowserItem>,
    rootPath: string
  ) {
    const lookup = items[path] ? items : fallbackItems
    for (const target of [
      path,
      ...getFileBrowserAncestorPaths(lookup, path, rootPath),
    ]) {
      revisions.set(target, (revisions.get(target) ?? 0) + 1)
    }
  }

  function update(next: FileTreeRevisionInputs) {
    const last = previous
    previous = next

    if (!last) {
      return
    }

    if (last.search !== next.search) {
      // Search matches can change on any row; a whole-tree pass is the
      // cheapest correct answer here, as it was before memoization.
      base += 1
    }

    const changed = new Set<string>()
    collectSymmetricDifference(last.expandedItems, next.expandedItems, changed)
    collectSymmetricDifference(last.selectedItems, next.selectedItems, changed)
    collectSymmetricDifference(
      last.loadingDirectories,
      next.loadingDirectories,
      changed
    )

    if (last.focusedItem !== next.focusedItem) {
      if (last.focusedItem) changed.add(last.focusedItem)
      if (next.focusedItem) changed.add(next.focusedItem)
    }

    if (last.model !== next.model) {
      collectChangedKeys(last.model.items, next.model.items, changed)
      collectChangedKeys(
        last.model.childrenByPath,
        next.model.childrenByPath,
        changed
      )
    }

    for (const path of changed) {
      bump(path, next.model.items, last.model.items, next.rootPath)
    }
  }

  function get(path: string) {
    return base + (revisions.get(path) ?? 0)
  }

  return { get, update }
}

export type FileTreeRevisions = ReturnType<typeof createFileTreeRevisions>

function collectSymmetricDifference(
  previous: Iterable<string>,
  next: Iterable<string>,
  target: Set<string>
) {
  const previousSet = new Set(previous)
  const nextSet = new Set(next)

  for (const value of previousSet) {
    if (!nextSet.has(value)) target.add(value)
  }
  for (const value of nextSet) {
    if (!previousSet.has(value)) target.add(value)
  }
}

function collectChangedKeys(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  target: Set<string>
) {
  if (previous === next) {
    return
  }

  for (const key in previous) {
    if (previous[key] !== next[key]) target.add(key)
  }
  for (const key in next) {
    if (!(key in previous)) target.add(key)
  }
}
