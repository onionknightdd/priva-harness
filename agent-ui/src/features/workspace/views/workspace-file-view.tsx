import * as React from "react"
import { ArrowLeftIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  RichFilePreview,
  workspaceReadmePreview,
} from "@/features/files"

export function WorkspaceFileView({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation()
  const [openedFiles, setOpenedFiles] = React.useState([
    workspaceReadmePreview,
  ])
  const [activeFileId, setActiveFileId] = React.useState<string | null>(
    workspaceReadmePreview.id
  )

  const handleFileClose = (fileId: string) => {
    const fileIndex = openedFiles.findIndex((file) => file.id === fileId)

    if (fileIndex === -1) {
      return
    }

    const adjacentFile =
      openedFiles[fileIndex + 1] ?? openedFiles[fileIndex - 1] ?? null

    setOpenedFiles((currentFiles) =>
      currentFiles.filter((file) => file.id !== fileId)
    )

    if (fileId === activeFileId) {
      setActiveFileId(adjacentFile?.id ?? null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center border-b px-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-w-0 justify-start px-2 font-normal"
          onClick={onBack}
        >
          <ArrowLeftIcon aria-hidden="true" />
          <span className="truncate">{t("workspace.backToHome")}</span>
        </Button>
      </div>
      <RichFilePreview
        activeFileId={activeFileId}
        files={openedFiles}
        onActiveFileChange={setActiveFileId}
        onCloseAll={() => {
          setOpenedFiles([])
          setActiveFileId(null)
        }}
        onFileClose={handleFileClose}
      />
    </div>
  )
}
