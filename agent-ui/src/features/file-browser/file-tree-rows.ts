export const FILE_TREE_ROW_HEIGHT = 26
/** Row height plus the 1px gap between rows. */
export const FILE_TREE_ROW_PITCH = FILE_TREE_ROW_HEIGHT + 1

export type FileTreeNode<T> = {
  isFolder: (node: T) => boolean
  isExpanded: (node: T) => boolean
  getChildren: (node: T) => T[]
}

export type FileTreeRow<T> = {
  node: T
  level: number
  positionInSet: number
  setSize: number
  /** Index of the parent row, or -1 for a root. */
  parent: number
  /** Index of the last row of this row's visible subtree (itself if none). */
  subtreeEnd: number
  /** An expanded folder with children: the only rows that can be pinned. */
  canStick: boolean
}

/** The rows a tree currently shows, in display order. */
export function flattenFileTree<T>(
  roots: T[],
  accessors: FileTreeNode<T>
): FileTreeRow<T>[] {
  const rows: FileTreeRow<T>[] = []

  const visit = (nodes: T[], level: number, parent: number) => {
    nodes.forEach((node, position) => {
      const index = rows.length
      const children =
        accessors.isFolder(node) && accessors.isExpanded(node)
          ? accessors.getChildren(node)
          : []
      const row: FileTreeRow<T> = {
        node,
        level,
        positionInSet: position + 1,
        setSize: nodes.length,
        parent,
        subtreeEnd: index,
        canStick: children.length > 0,
      }
      rows.push(row)
      visit(children, level + 1, index)
      row.subtreeEnd = rows.length - 1
    })
  }

  visit(roots, 0, -1)
  return rows
}

export type PinnedFileTreeRow = {
  index: number
  /**
   * 0 while the row rests in its slot. Negative while the end of its subtree
   * pushes it out from under the slot, by that many pixels.
   */
  shift: number
}

/**
 * The expanded ancestors held at the top of the viewport, outermost first.
 * `offset` is the distance scrolled into the list. A folder at level `d` owns
 * the slot `d` rows below the top: it is pinned once its own row has scrolled
 * above that slot, and leaves with the last row of its subtree.
 */
export function pinnedFileTreeRows<T>(
  rows: readonly FileTreeRow<T>[],
  offset: number
): PinnedFileTreeRow[] {
  const pinned: PinnedFileTreeRow[] = []

  if (offset <= 0 || rows.length === 0) {
    return pinned
  }

  for (let level = 0; ; level++) {
    const slotTop = offset + level * FILE_TREE_ROW_HEIGHT
    const under = Math.floor(slotTop / FILE_TREE_ROW_PITCH)

    if (under >= rows.length) {
      break
    }

    let index = under
    while (index >= 0 && rows[index].level > level) {
      index = rows[index].parent
    }

    const row = index >= 0 ? rows[index] : undefined
    if (
      !row ||
      row.level !== level ||
      !row.canStick ||
      index * FILE_TREE_ROW_PITCH >= slotTop
    ) {
      break
    }

    const subtreeBottom = (row.subtreeEnd + 1) * FILE_TREE_ROW_PITCH - 1
    pinned.push({
      index,
      shift: Math.min(0, subtreeBottom - FILE_TREE_ROW_HEIGHT - slotTop),
    })
  }

  return pinned
}

/**
 * The list offset that brings a row into view, or null if it already is. A
 * row can sit under as many pinned ancestors as its level, so the top edge
 * leaves that much room.
 */
export function fileTreeRevealOffset(
  row: { index: number; level: number },
  offset: number,
  viewportHeight: number
): number | null {
  const top = row.index * FILE_TREE_ROW_PITCH
  const covered = row.level * FILE_TREE_ROW_HEIGHT

  if (top < offset + covered) {
    return Math.max(0, top - covered)
  }

  if (top + FILE_TREE_ROW_HEIGHT > offset + viewportHeight) {
    return top + FILE_TREE_ROW_HEIGHT - viewportHeight
  }

  return null
}
