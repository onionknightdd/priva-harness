import * as React from "react"
import { useTranslation } from "react-i18next"

import type { FileSystemEntry } from "@/lib/api/sandbox-files"
import { FileTypeIcon } from "@/features/file-browser/components/file-type-icon"
import { FileTreeFolderIcon } from "@/features/file-browser/components/file-tree-folder-icon"

import { groupMentionEntries } from "../composer-mention"
import {
  ComposerSuggestMenu,
  type ComposerSuggestGroup,
} from "./composer-suggest-menu"

export function ComposerMentionMenu({
  open,
  menuId,
  entries,
  empty,
  highlightedIndex,
  anchorRef,
  inputRef,
  onOpenChange,
  onHighlight,
  onSelect,
}: {
  open: boolean
  menuId: string
  entries: readonly FileSystemEntry[]
  empty: string
  highlightedIndex: number
  anchorRef: React.RefObject<HTMLElement | null>
  inputRef: React.RefObject<HTMLElement | null>
  onOpenChange: (open: boolean) => void
  onHighlight: (index: number) => void
  onSelect: (entry: FileSystemEntry) => void
}) {
  const { t } = useTranslation()
  const grouped = React.useMemo(
    () => groupMentionEntries(entries),
    [entries]
  )
  const groups = React.useMemo((): ComposerSuggestGroup[] => {
    return grouped.map((group) => ({
      id: group.kind,
      label:
        group.kind === "directory"
          ? t("agentMessage.mentionFolderGroup")
          : t("agentMessage.mentionFileGroup"),
      items: group.entries.map((entry) => ({
        id: entry.path,
        content: (
          <>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              {entry.type === "directory" ? (
                <FileTreeFolderIcon expanded={false} />
              ) : (
                <FileTypeIcon name={entry.name} path={entry.path} />
              )}
              <span className="min-w-0 truncate">{entry.name}</span>
            </span>
            <span className="text-muted-foreground ml-auto text-xs tracking-normal normal-case">
              {entry.type === "directory"
                ? t("agentMessage.mentionFolderGroup")
                : t("agentMessage.mentionFileGroup")}
            </span>
          </>
        ),
      })),
    }))
  }, [grouped, t])

  return (
    <ComposerSuggestMenu
      open={open}
      menuId={menuId}
      label={t("agentMessage.mentionMenuLabel")}
      empty={empty}
      groups={groups}
      highlightedIndex={highlightedIndex}
      anchorRef={anchorRef}
      inputRef={inputRef}
      onOpenChange={onOpenChange}
      onHighlight={onHighlight}
      onSelect={(index) => {
        const selected = grouped.flatMap((group) => group.entries)[index]
        if (selected) {
          onSelect(selected)
        }
      }}
    />
  )
}
