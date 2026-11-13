import { ChevronDownIcon, DownloadIcon, LoaderCircleIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { TooltipHint } from "@/components/ui/tooltip"
import type { WhiteboardFile } from "./use-whiteboard-files"

export type WhiteboardFilePickerOptions = {
  files: WhiteboardFile[]; loading: boolean; error: string | null
  onRefresh(): void
  onSelect(path: string): void
}

export function WhiteboardFileMenu({ path, filename, picker }: { path: string; filename: string; picker: WhiteboardFilePickerOptions }) {
  const { t } = useTranslation()
  const label = filename.replace(/\.json$/i, "")
  return <DropdownMenu onOpenChange={open => { if (open) picker.onRefresh() }}>
    <DropdownMenuTrigger render={<Button variant="ghost" size="xs" className="wb-file-picker" title={label} aria-label={t("whiteboard.switchFile")} />}>
      <span>{label}</span><ChevronDownIcon className="size-3 shrink-0" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-64 max-w-[calc(100vw-32px)]">
      <DropdownMenuRadioGroup value={path} onValueChange={value => { if (value !== path) picker.onSelect(value) }}>
        {picker.files.map(file => <DropdownMenuRadioItem key={file.path} value={file.path} title={file.path}><span className="truncate">{file.name.replace(/\.json$/i, "")}</span></DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
      {picker.loading && <DropdownMenuItem disabled>{t("whiteboard.loadingFiles")}</DropdownMenuItem>}
      {picker.error && <><div role="alert" className="px-2 py-1.5 text-xs text-destructive">{t("whiteboard.listFailed")}</div><DropdownMenuItem closeOnClick={false} onClick={picker.onRefresh}>{t("whiteboard.retry")}</DropdownMenuItem></>}
      {!picker.loading && !picker.error && !picker.files.length && <DropdownMenuItem disabled>{t("whiteboard.noFiles")}</DropdownMenuItem>}
    </DropdownMenuContent>
  </DropdownMenu>
}

export function WhiteboardDownloadMenu({ busy, disabled, onDownload }: { busy: boolean; disabled: boolean; onDownload(format: "png" | "pdf"): void }) {
  const { t } = useTranslation()
  const label = t(busy ? "whiteboard.exporting" : "whiteboard.download")
  return <DropdownMenu>
    <TooltipHint content={label}><DropdownMenuTrigger disabled={disabled || busy} render={<Button variant="ghost" size="icon-xs" aria-label={label} aria-busy={busy} />}>
      {busy ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <DownloadIcon />}
    </DropdownMenuTrigger></TooltipHint>
    <DropdownMenuContent align="end" className="w-40">
      <DropdownMenuItem onClick={() => onDownload("png")}>{t("whiteboard.downloadPng")}</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onDownload("pdf")}>{t("whiteboard.downloadPdf")}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}
