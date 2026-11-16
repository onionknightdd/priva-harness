import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { Lightbox } from "@/components/interior/lightbox"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { focusRing } from "@/lib/surfaces"
import { cn } from "@/lib/utils"
import { dashboardImageUrl } from "./image-source"

type Props = {
  url: string
  description: string
  fit?: "contain" | "cover"
  /** Internal gallery controls; not exposed in the model's Image schema. */
  active?: boolean
  onSelect?: () => void
}

export function DashboardImage({ url, ...props }: Props) {
  const source = dashboardImageUrl(url)
  // A bound URL change starts a new preview, including its loading/error state.
  return <ImagePreview key={source} {...props} source={source} local={/^sandbox:/i.test(url)} />
}

function ImagePreview({ source, local, description, fit = "contain", active = true, onSelect }: Omit<Props, "url"> & { source: string; local: boolean }) {
  const { t } = useTranslation()
  const originRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")
  const [attempt, setAttempt] = useState(0)
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>()
  // Remote URLs can be signed; retry them unchanged rather than invalidating the signature.
  const src = local && attempt ? `${source}&retry=${attempt}` : source
  useEffect(() => { if (!active) setOpen(false) }, [active])

  return <div className="a2ui-image" data-fit={fit} data-state={state}>
    {state === "error" ? <div className="a2ui-image-error">
      <p role="alert">{t("agentMessage.imageTools.loadFailed")}</p>
      <Button variant="outline" size="sm" tabIndex={active ? 0 : -1} onClick={() => { onSelect?.(); setAttempt((value) => value + 1); setState("loading") }}>
        {t("agentMessage.imageTools.retryPreview")}
      </Button>
    </div> : <button
      ref={originRef}
      type="button"
      aria-label={t("toolCard.viewNamedImage", { name: description })}
      aria-busy={state === "loading"}
      tabIndex={active ? 0 : -1}
      disabled={state !== "ready"}
      onClick={() => { if (onSelect) onSelect(); else setOpen(true) }}
      className={cn("a2ui-image-frame", focusRing)}
    >
      {state === "loading" ? <Skeleton className="absolute inset-0 size-full rounded-none motion-reduce:animate-none">
        <span className="sr-only">{t("agentMessage.imageTools.loading")}</span>
      </Skeleton> : null}
      <img
        key={attempt}
        src={src}
        alt={description}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        draggable={false}
        onLoad={(event) => {
          setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
          setState("ready")
        }}
        onError={() => setState("error")}
      />
    </button>}
    <Lightbox open={active && open} onClose={() => setOpen(false)} originRef={originRef} src={src} alt={description} caption={description} width={dimensions?.width} height={dimensions?.height} />
  </div>
}
