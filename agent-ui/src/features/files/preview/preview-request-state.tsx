import { LoaderCircleIcon, TriangleAlertIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

export function PreviewRequestState({
  error,
  loading = false,
}: {
  error?: string
  loading?: boolean
}) {
  const { t } = useTranslation()
  const Icon = loading ? LoaderCircleIcon : TriangleAlertIcon

  return (
    <div
      role={loading ? "status" : "alert"}
      className="flex min-h-full flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon
          aria-hidden="true"
          className={
            loading
              ? "size-5 animate-spin motion-reduce:animate-none"
              : "size-5"
          }
          strokeWidth={1.5}
        />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {t(
            loading
              ? "filePreview.loadingTitle"
              : "filePreview.loadFailedTitle"
          )}
        </p>
        {!loading && (
          <p className="max-w-sm text-xs leading-5 text-muted-foreground">
            {error || t("filePreview.loadFailedDescription")}
          </p>
        )}
      </div>
    </div>
  )
}
