import type { GitChange, GitRepository } from "@/lib/api/git-repository"

export type GitChangeGroups = {
  conflicted: GitChange[]
  staged: GitChange[]
  unstaged: GitChange[]
  untracked: GitChange[]
}

function hasStatus(status: string) {
  return status !== "" && status !== " " && status !== "."
}

export function groupGitChanges(changes: readonly GitChange[]): GitChangeGroups {
  const groups: GitChangeGroups = { conflicted: [], staged: [], unstaged: [], untracked: [] }
  for (const change of changes) {
    if (change.conflicted) {
      groups.conflicted.push(change)
    } else if (change.indexStatus === "?" || change.worktreeStatus === "?") {
      groups.untracked.push(change)
    } else {
      // Partially staged files belong to both comparisons: HEAD → index and index → worktree.
      if (hasStatus(change.indexStatus)) groups.staged.push(change)
      if (hasStatus(change.worktreeStatus)) groups.unstaged.push(change)
    }
  }
  return groups
}

export type GitDecoration = {
  status: string
  kind: "file" | "directory"
  conflicted: boolean
}

export function gitChangeStatus(change: GitChange) {
  if (change.conflicted) return "U"
  if (change.indexStatus === "?" || change.worktreeStatus === "?") return "?"
  if (change.indexStatus === "R" || change.worktreeStatus === "R") return "R"
  if (change.worktreeStatus === "D") return "D"
  if (change.indexStatus === "A") return "A"
  return hasStatus(change.worktreeStatus) ? change.worktreeStatus : change.indexStatus
}

export function createGitDecorations(repository: GitRepository | null): Map<string, GitDecoration> {
  const decorations = new Map<string, GitDecoration>()
  if (!repository?.root) return decorations
  const root = repository.root.replace(/\/+$/, "") || "/"
  const absolute = (path: string) => `${root === "/" ? "" : root}/${path}`

  for (const change of repository.changes) {
    decorations.set(absolute(change.path), { status: gitChangeStatus(change), kind: "file", conflicted: change.conflicted })
  }
  for (const change of repository.changes) {
    // A rename also changes its old parent, even when the old entry no longer exists in the tree.
    if (change.originalPath && (change.indexStatus === "R" || change.worktreeStatus === "R") && !decorations.has(absolute(change.originalPath))) {
      decorations.set(absolute(change.originalPath), { status: "D", kind: "file", conflicted: change.conflicted })
    }
  }
  for (const [path, decoration] of [...decorations]) {
    let parent = path.slice(0, path.lastIndexOf("/")) || "/"
    while (parent === root || (root === "/" ? parent.startsWith("/") : parent.startsWith(`${root}/`))) {
      const existing = decorations.get(parent)
      if (!existing) {
        decorations.set(parent, { status: ".", kind: "directory", conflicted: decoration.conflicted })
      } else if (decoration.conflicted && !existing.conflicted) {
        decorations.set(parent, { ...existing, conflicted: true })
      }
      if (parent === root) break
      parent = parent.slice(0, parent.lastIndexOf("/")) || "/"
    }
  }
  return decorations
}
