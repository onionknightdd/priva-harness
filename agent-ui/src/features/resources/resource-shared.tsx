import { FolderIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export function ResourceLoading() {
  const { t } = useTranslation()
  return <div role="status" aria-label={t("resources.loading")} className="space-y-3 p-5"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-24 w-full" /></div>
}

export function ResourceEmpty({ text, compact = false }: { text: string; compact?: boolean }) {
  return <div className={cn("flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground", compact && "py-10 text-xs")}><FolderIcon aria-hidden className="size-7 stroke-1" /><p>{text}</p></div>
}

export function ResourceErrorState({ message, retry }: { message: string; retry?: () => void }) {
  const { t } = useTranslation()
  return <div role="alert" className="space-y-3 p-4 text-sm"><p className="break-words text-destructive">{message}</p>{retry && <Button variant="outline" size="sm" onClick={retry}>{t("resources.retry")}</Button>}</div>
}
