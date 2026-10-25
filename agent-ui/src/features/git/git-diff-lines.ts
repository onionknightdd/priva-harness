export type GitDiffLine = {
  kind: "context" | "added" | "removed" | "hunk" | "meta"
  text: string
  oldLine?: number
  newLine?: number
}

/** Only interpret +/- after a hunk header, so file metadata cannot become code. */
export function parseGitDiff(patch: string): GitDiffLine[] {
  const result: GitDiffLine[] = []
  let oldLine = 0
  let newLine = 0
  let inHunk = false
  const lines = patch.split("\n")
  if (lines.at(-1) === "") lines.pop()
  for (const text of lines) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      inHunk = true
      result.push({ kind: "hunk", text })
    } else if (text.startsWith("diff ") || text.startsWith("@@@")) {
      inHunk = false
      result.push({ kind: "meta", text })
    } else if (inHunk && text.startsWith("+")) {
      result.push({ kind: "added", text: text.slice(1), newLine: newLine++ })
    } else if (inHunk && text.startsWith("-")) {
      result.push({ kind: "removed", text: text.slice(1), oldLine: oldLine++ })
    } else if (inHunk && text.startsWith(" ")) {
      result.push({ kind: "context", text: text.slice(1), oldLine: oldLine++, newLine: newLine++ })
    } else {
      result.push({ kind: "meta", text })
    }
  }
  return result
}

export type GitSplitRow = { left?: GitDiffLine; right?: GitDiffLine; heading?: GitDiffLine }

export function splitGitDiff(lines: GitDiffLine[]): GitSplitRow[] {
  const rows: GitSplitRow[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (line.kind === "removed" || line.kind === "added") {
      const left: GitDiffLine[] = []
      const right: GitDiffLine[] = []
      while (index < lines.length && ["removed", "added"].includes(lines[index].kind)) {
        const changed = lines[index++]
        ;(changed.kind === "removed" ? left : right).push(changed)
      }
      for (let row = 0; row < Math.max(left.length, right.length); row++) rows.push({ left: left[row], right: right[row] })
    } else {
      rows.push(line.kind === "context" ? { left: line, right: line } : { heading: line })
      index++
    }
  }
  return rows
}
