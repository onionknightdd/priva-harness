import { useContext, useLayoutEffect, useRef, useState } from "react"
import { CopyIcon, FolderOpenIcon, MessageSquareQuoteIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import { FilePathLink } from "@/features/files/file-path-link"
import { useFileExists } from "@/features/files/use-file-exists"
import { useOptionalWorkspaceFiles } from "@/features/workspace/workspace-files-context"
import { writeClipboardText } from "@/lib/clipboard"
import { isAbsoluteFilePath } from "@/lib/file-path"

import { PopupsArmedContext } from "@/components/ui/popups-armed-context"
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
  // A transcript can hold hundreds of references; the surrounding message
  // arms its popups when the pointer or focus reaches it, which precedes the
  // events that open a context menu (right click, long press, Shift+F10).
  const armed = useContext(PopupsArmedContext)
  const restoreFocus = useRef(false)
  const link = <FilePathLink path={path} label={label} tooltip={path} showIcon variant="code" className={className} />
  const focusable = exists && workspace ? undefined : 0

  // Keyboard users can arm the message by focusing this link; the trigger
  // then remounts, so put focus back on the equivalent element.
  useLayoutEffect(() => {
    if (!armed || !restoreFocus.current) return
    restoreFocus.current = false
    ;(triggerRef.current?.querySelector("button") ?? triggerRef.current)?.focus()
  }, [armed])

  if (!armed) {
    return (
      <span
        ref={triggerRef}
        className="inline-flex max-w-full min-w-0 select-text align-middle"
        tabIndex={focusable}
        onFocus={() => {
          restoreFocus.current = true
        }}
      >
        {link}
      </span>
    )
  }

  return (
    <ContextMenu open={open} onOpenChange={(next) => {
      setOpen(next)
      if (next) {
        setCopyError(false)
        quoted.current = false
      }
    }}>
      <ContextMenuTrigger className="select-text" tabIndex={focusable}
        render={<span ref={triggerRef} className="inline-flex max-w-full min-w-0 align-middle" />}>
        {link}
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
