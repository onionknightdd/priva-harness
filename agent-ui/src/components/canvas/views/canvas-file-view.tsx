import { ArrowLeftIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  RichFilePreview,
  canvasReadmePreview,
} from "@/features/files"

export function CanvasFileView({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation()

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
          <span className="truncate">{t("canvas.backToHome")}</span>
        </Button>
      </div>
      <RichFilePreview file={canvasReadmePreview} />
    </div>
  )
}
