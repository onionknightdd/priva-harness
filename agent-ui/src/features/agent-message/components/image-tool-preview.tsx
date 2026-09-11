import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { Lightbox } from "@/components/interior/lightbox"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { getDownloadUrl } from "@/lib/api/sandbox-files"
import { focusRing } from "@/lib/surfaces"
import { cn } from "@/lib/utils"

type ImageToolPreviewProps = {
  path: string
  alt: string
  className?: string
}

export function ImageToolPreview(props: ImageToolPreviewProps) {
  return <ImagePreview key={props.path} {...props} />
}

function ImagePreview({ path, alt, className }: ImageToolPreviewProps) {
  const { t } = useTranslation()
  const originRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")
  const [attempt, setAttempt] = useState(0)
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>()
  const src = `${getDownloadUrl(path)}${attempt ? `&retry=${attempt}` : ""}`

  if (state === "error") {
    return (
      <div className={cn("flex h-64 min-w-0 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-muted/20 p-4", className)}>
        <p role="alert" className="text-sm text-destructive">{t("agentMessage.imageTools.loadFailed")}</p>
        <Button variant="outline" size="sm" onClick={() => {
          setAttempt((value) => value + 1)
          setState("loading")
        }}>{t("agentMessage.imageTools.retryPreview")}</Button>
      </div>
    )
  }

  return (
    <>
      <button
        ref={originRef}
        type="button"
        aria-label={t("toolCard.viewNamedImage", { name: alt })}
        aria-busy={state === "loading"}
        disabled={state !== "ready"}
        onClick={() => setOpen(true)}
        className={cn(
          "relative block h-64 w-full min-w-0 overflow-hidden rounded-lg border border-border bg-muted/20 outline-none enabled:cursor-zoom-in enabled:hover:border-ring",
          "transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none",
          focusRing,
          className
        )}
      >
        {state === "loading" ? (
          <Skeleton className="absolute inset-0 size-full rounded-none motion-reduce:animate-none">
            <span className="sr-only">{t("agentMessage.imageTools.loading")}</span>
          </Skeleton>
        ) : null}
        <img
          src={src}
          alt={alt}
          draggable={false}
          className={cn("size-full object-contain transition-opacity duration-150 motion-reduce:transition-none", state === "ready" ? "opacity-100" : "opacity-0")}
          onLoad={(event) => {
            setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
            setState("ready")
          }}
          onError={() => setState("error")}
        />
      </button>
      <Lightbox
        open={open}
        onClose={() => setOpen(false)}
        originRef={originRef}
        src={src}
        alt={alt}
        caption={alt}
        width={dimensions?.width}
        height={dimensions?.height}
      />
    </>
  )
}
