import { EditorState } from "prosemirror-state"

import type { FileSystemEntry } from "@/lib/api/sandbox-files"

export type MentionTrigger = {
  from: number
  to: number
  query: string
  directory: string
  filter: string
}

export type MentionPathParts = {
  directory: string
  filter: string
}

const MENTION_TOKEN = /(?:^|[\s\n])(@[^\s]*)$/

export function parseMentionTrigger(
  textBeforeCaret: string,
  textAfterCaret = ""
): {
  raw: string
  query: string
} | null {
  const match = MENTION_TOKEN.exec(textBeforeCaret)
  if (!match) {
    return null
  }

  const suffix = /^[^\s\n]*/.exec(textAfterCaret)?.[0] ?? ""
  const raw = `${match[1] ?? ""}${suffix}`
  return { raw, query: raw.slice(1) }
}

export function splitMentionQuery(query: string): MentionPathParts {
  if (query.endsWith("/")) {
    return { directory: query.slice(0, -1), filter: "" }
  }

  const slash = query.lastIndexOf("/")
  if (slash === -1) {
    return { directory: "", filter: query }
  }

  return {
    directory: query.slice(0, slash),
    filter: query.slice(slash + 1),
  }
}

export function mentionListPath(root: string, directory: string) {
  const base = root.replace(/\/+$/, "")
  const relative = directory.trim().replace(/^\/+/, "")
  if (relative === "") {
    return base === "" ? "/" : base
  }

  return `${base}/${relative}`
}

export function completeMentionQuery(
  query: string,
  name: string,
  type: FileSystemEntry["type"]
) {
  const { directory } = splitMentionQuery(query)
  const nextPath = directory === "" ? name : `${directory}/${name}`
  if (type === "directory") {
    return { query: `${nextPath}/`, close: false }
  }

  return { query: nextPath, close: true }
}

export function applyMentionCompletion(
  textBeforeCaret: string,
  nextQuery: string
) {
  const trigger = parseMentionTrigger(textBeforeCaret)
  if (!trigger) {
    return `@${nextQuery}`
  }

  return `${textBeforeCaret.slice(0, -trigger.raw.length)}@${nextQuery}`
}

export function filterMentionEntries(
  entries: readonly FileSystemEntry[],
  filter: string
): FileSystemEntry[] {
  const needle = filter.trim().toLocaleLowerCase()
  if (needle === "") {
    return [...entries]
  }

  return entries
    .flatMap((entry) => {
      const rank = mentionMatchRank(entry.name, needle)
      return rank === null ? [] : [{ entry, rank }]
    })
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        mentionTypeRank(left.entry.type) - mentionTypeRank(right.entry.type) ||
        left.entry.name.localeCompare(right.entry.name)
    )
    .map((item) => item.entry)
}

function mentionTypeRank(type: FileSystemEntry["type"]) {
  return type === "directory" ? 0 : 1
}

function mentionMatchRank(name: string, needle: string): number | null {
  const value = name.toLocaleLowerCase()
  if (value.startsWith(needle)) {
    return 0
  }
  if (value.includes(needle)) {
    return 1
  }
  return null
}

export function groupMentionEntries(entries: readonly FileSystemEntry[]): {
  kind: FileSystemEntry["type"]
  entries: FileSystemEntry[]
}[] {
  const grouped: {
    kind: FileSystemEntry["type"]
    entries: FileSystemEntry[]
  }[] = [
    { kind: "directory", entries: [] },
    { kind: "file", entries: [] },
  ]

  for (const entry of entries) {
    const group = grouped.find((item) => item.kind === entry.type)
    group?.entries.push(entry)
  }

  return grouped.filter((group) => group.entries.length > 0)
}

export function visibleMentionEntries(
  entries: readonly FileSystemEntry[]
): FileSystemEntry[] {
  return groupMentionEntries(entries).flatMap((group) => group.entries)
}

export function mentionTriggerFromState(
  state: EditorState
): MentionTrigger | null {
  if (!state.selection.empty) {
    return null
  }

  const caret = state.selection.from
  const textBefore = state.doc.textBetween(0, caret, "\n", "\n")
  const prefix = parseMentionTrigger(textBefore)
  if (!prefix) {
    return null
  }

  const suffix =
    /^[^\s\n]*/.exec(
      state.doc.textBetween(caret, state.doc.content.size, "\n", "\n")
    )?.[0] ?? ""
  const from = caret - prefix.raw.length
  if (from < 0) {
    return null
  }

  const query = `${prefix.query}${suffix}`
  const parts = splitMentionQuery(query)
  return {
    from,
    to: caret + suffix.length,
    query,
    directory: parts.directory,
    filter: parts.filter,
  }
}

export function mentionTriggersEqual(
  left: MentionTrigger | null,
  right: MentionTrigger | null
) {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return false
  }

  return (
    left.from === right.from &&
    left.to === right.to &&
    left.query === right.query &&
    left.directory === right.directory &&
    left.filter === right.filter
  )
}
