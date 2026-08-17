import { FileQuestionIcon, MousePointerClickIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

export function UnsupportedPreview({ hasFile }: { hasFile: boolean }) {
  const { t } = useTranslation()
  const Icon = hasFile ? FileQuestionIcon : MousePointerClickIcon

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-5" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {t(
            hasFile
              ? "filePreview.unsupportedTitle"
              : "filePreview.emptyTitle"
          )}
        </p>
        <p className="max-w-sm text-xs leading-5 text-muted-foreground">
          {t(
            hasFile
              ? "filePreview.unsupportedDescription"
              : "filePreview.emptyDescription"
          )}
        </p>
      </div>
    </div>
  )
}
