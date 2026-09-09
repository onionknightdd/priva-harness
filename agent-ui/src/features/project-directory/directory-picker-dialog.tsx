import * as React from "react"
import { FolderPlusIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { FileBrowserTree } from "@/features/file-browser/components/file-browser-tree"
import { CreateFolderDialog } from "@/features/file-browser/components/file-operation-dialogs"

import { useDirectoryPicker } from "./use-directory-picker"
import { TooltipHint } from "@/components/ui/tooltip"

export function DirectoryPickerDialog({
  open, initialPath, onOpenChange, onConfirm,
}: {
  open: boolean
  initialPath: string
  onOpenChange: (open: boolean) => void
  onConfirm: (path: string) => void
}) {
  const { t } = useTranslation()
  const picker = useDirectoryPicker(open, initialPath)
  const [pathInput, setPathInput] = React.useState("")
  const [createParent, setCreateParent] = React.useState<string | null>(null)
  const [feedback, setFeedback] = React.useState("")
  const pathInputRef = React.useRef<HTMLInputElement>(null)
  const createButtonRef = React.useRef<HTMLButtonElement>(null)
  const confirmationRef = React.useRef(false)

  React.useEffect(() => {
    setPathInput("")
    setCreateParent(null)
    setFeedback("")
    confirmationRef.current = false
  }, [open])

  const navigate = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!pathInput.trim() || picker.navigating) return
    if (await picker.navigateTo(pathInput)) setPathInput("")
  }

  const retry = async () => {
    if (pathInput.trim()) {
      if (await picker.navigateTo(pathInput)) setPathInput("")
    } else {
      await picker.retry()
    }
  }

  const confirmDirectory = async () => {
    if (confirmationRef.current) return
    confirmationRef.current = true
    try {
      const path = await picker.confirmSelection()
      if (path) {
        onConfirm(path)
        onOpenChange(false)
      }
    } finally {
      confirmationRef.current = false
    }
  }

  const busy = picker.navigating || picker.confirming
  const canUse = Boolean(picker.selectedPath) && !busy && !pathInput.trim()
    && !picker.loadingDirectories.has(picker.selectedPath ?? "")

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!createParent) onOpenChange(next) }}>
      <DialogContent
        initialFocus={pathInputRef}
        className="flex h-[min(36rem,calc(100dvh-2rem))] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogHeader className="gap-1.5 px-5 pt-5 pb-4 pr-12">
          <DialogTitle>{t("directoryPicker.title")}</DialogTitle>
          <DialogDescription>{t("directoryPicker.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 border-b px-5 pb-3">
          <form onSubmit={(event) => { void navigate(event) }} className="flex min-w-0 flex-1 basis-full gap-2 sm:basis-0">
            <Input
              ref={pathInputRef}
              aria-label={t("directoryPicker.path")}
              placeholder={t("directoryPicker.pathPlaceholder")}
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              readOnly={picker.navigating}
              disabled={picker.confirming}
              className="h-8 min-w-0 flex-1 text-xs"
            />
            <Button type="submit" size="sm" variant="outline" disabled={busy || !pathInput.trim()}>
              {t("directoryPicker.go")}
            </Button>
          </form>
          <Button
            ref={createButtonRef}
            type="button" size="sm" variant="outline"
            disabled={!picker.selectedPath || busy || Boolean(pathInput.trim())}
            onClick={() => setCreateParent(picker.selectedPath)}
          >
            <FolderPlusIcon aria-hidden="true" />
            {t("fileBrowser.createDialog.title")}
          </Button>
        </div>

        {picker.error && (
          <div className="flex items-start gap-2 border-b bg-destructive/5 px-5 py-2.5">
            <p role="alert" className="min-w-0 flex-1 break-words text-xs text-destructive">{picker.error.message}</p>
            <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => { void retry() }}>
              {t("directoryPicker.retry")}
            </Button>
          </div>
        )}

        <div
          data-file-tree-scroll
          aria-busy={busy}
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3"
          inert={picker.confirming || undefined}
        >
          {/* Keep spacing inside the scroller so sticky rows cover its top edge. */}
          <div className="py-0.75">
            {picker.rootPath ? (
              <FileBrowserTree
                compact
                model={picker.model}
                rootPath={picker.rootPath}
                selectedItemPath={picker.selectedPath}
                loadingDirectories={picker.loadingDirectories}
                query=""
                onItemSelect={(path) => {
                  setPathInput("")
                  return picker.selectDirectory(path)
                }}
                onFolderExpand={picker.expandDirectory}
                onActionFeedback={setFeedback}
              />
            ) : picker.navigating ? (
              <div className="space-y-1.5 px-2 py-3" aria-label={t("directoryPicker.loading")}>
                {[0, 1, 2, 3, 4].map((depth) => (
                  <Skeleton key={depth} className="h-6 w-2/3" style={{ marginLeft: depth * 12 }} />
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t px-5 py-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1" aria-live="polite" aria-atomic="true">
            <p className="text-xs text-muted-foreground">{t("directoryPicker.selected")}</p>
            <TooltipHint content={picker.selectedPath ?? undefined}>
              <p className="mt-1 truncate text-xs">
                {picker.selectedPath ?? t("directoryPicker.noneSelected")}
              </p>
            </TooltipHint>
          </div>
          <div className="flex shrink-0 justify-between gap-2 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("fileBrowser.createDialog.cancel")}
            </Button>
            <Button type="button" disabled={!canUse} onClick={() => { void confirmDirectory() }}>
              {t("directoryPicker.use")}
            </Button>
          </div>
        </div>
        <span className="sr-only" role="status">{feedback}</span>

        <CreateFolderDialog
          directory={createParent}
          finalFocus={createButtonRef}
          onCreate={picker.makeDirectory}
          onOpenChange={(next) => { if (!next) setCreateParent(null) }}
        />
      </DialogContent>
    </Dialog>
  )
}
