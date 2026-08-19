import * as React from "react"
import {
  CopyIcon,
  DownloadIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { writeClipboardText } from "@/lib/clipboard"

import {
  getFileBrowserParentPath,
  type FileBrowserItem,
} from "../file-browser-data"

export function FileTreeItemMenu({
  children,
  item,
  onActionFeedback,
  onDeleteRequest,
  onDownload,
  onUpload,
}: {
  children: React.ReactElement
  item: FileBrowserItem
  onActionFeedback: (message: string) => void
  onDeleteRequest: (target: FileBrowserItem) => void
  onDownload: (target: FileBrowserItem) => void
  onUpload: (directory: string) => void
}) {
  const { t } = useTranslation()
  const uploadDirectory =
    item.type === "folder"
      ? item.path
      : item.parentPath ?? getFileBrowserParentPath(item.path)

  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent>
        <ContextMenuItem
          onClick={() => {
            void writeClipboardText(item.path)
              .then(() =>
                onActionFeedback(
                  t("fileBrowser.pathCopied", { path: item.path })
                )
              )
              .catch(() =>
                onActionFeedback(t("fileBrowser.copyPathFailed"))
              )
          }}
        >
          <CopyIcon aria-hidden="true" />
          {t("fileBrowser.contextMenu.copyPath")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={item.type === "folder"}
          onClick={() => onDownload(item)}
        >
          <DownloadIcon aria-hidden="true" />
          {t("fileBrowser.contextMenu.download")}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!uploadDirectory}
          onClick={() => {
            if (uploadDirectory) {
              onUpload(uploadDirectory)
            }
          }}
        >
          <UploadIcon aria-hidden="true" />
          {t("fileBrowser.contextMenu.uploadHere")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onClick={() => onDeleteRequest(item)}
        >
          <Trash2Icon aria-hidden="true" />
          {t("fileBrowser.contextMenu.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
