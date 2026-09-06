import * as React from "react"
import { useTranslation } from "react-i18next"
import { Skeleton } from "@/components/ui/skeleton"

const FileBrowserPage = React.lazy(async () => {
  const module = await import("@/features/file-browser")

  return { default: module.FileBrowserPage }
})

export function WorkspaceFileView() {
  const { t } = useTranslation()
  return (
    <React.Suspense fallback={<div className="space-y-3 p-2" role="status" aria-label={t("common.loading")}>
      <Skeleton className="h-7 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-2/3" />
    </div>}>
      <FileBrowserPage className="h-full p-0" compact />
    </React.Suspense>
  )
}
