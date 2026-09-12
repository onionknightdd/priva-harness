import { useContext, useRef, useState } from "react"
import { CopyIcon, FolderOpenIcon, MessageSquareQuoteIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import { FilePathLink } from "@/features/files/file-path-link"
import { useFileExists } from "@/features/files/use-file-exists"
import { useOptionalWorkspaceFiles } from "@/features/workspace/workspace-files-context"
import { writeClipboardText } from "@/lib/clipboard"
import { isAbsoluteFilePath } from "@/lib/file-path"

import { AssistantSelectionActionContext } from "../selection-actions-context"

export function AssistantFileReference({ path, label, className }: {
  path: string
  label: string
  className?: string
}) {
  const { t } = useTranslation()
  const workspace = useOptionalWorkspaceFiles()
  const onSelectionAction = useContext(AssistantSelectionActionContext)
  const exists = useFileExists(path)
  const absolute = isAbsoluteFilePath(path)
  const [open, setOpen] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const quoted = useRef(false)

  return (
    <ContextMenu open={open} onOpenChange={(next) => {
      setOpen(next)
      if (next) {
        setCopyError(false)
        quoted.current = false
      }
    }}>
      <ContextMenuTrigger className="select-text" tabIndex={exists && workspace ? undefined : 0}
        render={<span ref={triggerRef} className="inline-flex max-w-full min-w-0 align-middle" />}>
        <FilePathLink path={path} label={label} showIcon variant="code" className={className} />
      </ContextMenuTrigger>
      <ContextMenuContent finalFocus={() => quoted.current ? false : triggerRef.current?.querySelector("button") ?? triggerRef.current}>
        <ContextMenuItem className="text-xs" disabled={!absolute || !exists || !workspace}
          onClick={() => workspace?.openFileInWorkspace(path)}>
          <FolderOpenIcon aria-hidden="true" />
          {t("agentMessage.fileReferenceMenu.open")}
        </ContextMenuItem>
        <ContextMenuItem className="text-xs" disabled={!absolute} closeOnClick={false}
          onClick={() => {
            setCopyError(false)
            void writeClipboardText(path).then(() => setOpen(false)).catch(() => setCopyError(true))
          }}>
          <CopyIcon aria-hidden="true" />
          {t("agentMessage.fileReferenceMenu.copyPath")}
        </ContextMenuItem>
        {copyError ? <p role="alert" className="px-2 py-1 text-xs text-destructive">{t("fileBrowser.copyPathFailed")}</p> : null}
        <ContextMenuItem className="text-xs" disabled={!absolute || !onSelectionAction}
          onClick={() => {
            quoted.current = true
            window.getSelection()?.removeAllRanges()
            onSelectionAction?.("quote", path)
          }}>
          <MessageSquareQuoteIcon aria-hidden="true" />
          {t("agentMessage.fileReferenceMenu.quote")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
