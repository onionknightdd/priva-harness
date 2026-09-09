import * as React from "react"
import { RefreshCwIcon, SearchIcon, UploadIcon, XIcon } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { EASE_OUT } from "@/lib/ease"
import { cn } from "@/lib/utils"
import { ResourceIconButton } from "./resource-icon-button"
import { TooltipHint } from "@/components/ui/tooltip"

export function SkillListHeader({ query, onQueryChange, loading, onRefresh, onUpload }: {
  query: string; onQueryChange: (query: string) => void; loading: boolean; onRefresh: () => void; onUpload: () => void
}) {
  const { t } = useTranslation()
  const [searching, setSearching] = React.useState(false)
  const [keyboard, setKeyboard] = React.useState(false)
  const reduced = useReducedMotion()
  const input = React.useRef<HTMLInputElement>(null)
  const trigger = React.useRef<HTMLButtonElement>(null)
  const restoreFocus = React.useRef(false)
  React.useEffect(() => {
    if (searching) input.current?.focus()
    else if (restoreFocus.current) { restoreFocus.current = false; trigger.current?.focus() }
  }, [searching])
  const close = (restore: boolean) => { restoreFocus.current = restore; onQueryChange(""); setSearching(false) }
  return <div className="relative h-8" onKeyDownCapture={() => setKeyboard(true)} onPointerDownCapture={() => setKeyboard(false)}>
    <AnimatePresence initial={false} mode="popLayout">
      {searching || query ? <motion.div key="search" className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced || keyboard ? 0 : 0.15, ease: EASE_OUT }} onBlurCapture={(event) => {
        if (!query && !event.currentTarget.contains(event.relatedTarget)) close(false)
      }}>
        <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input ref={input} value={query} onChange={(event) => onQueryChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(true) } }} aria-label={t("resources.search")} placeholder={t("resources.search")} className="h-8 border-0 bg-muted pr-8 pl-8 shadow-none focus-visible:ring-0 dark:bg-muted" />
        <TooltipHint content={t("sidebar.projects.clearSearch")}><ResourceIconButton className="absolute top-1/2 right-1 -translate-y-1/2" aria-label={t("sidebar.projects.clearSearch")} onClick={() => close(true)}><XIcon /></ResourceIconButton></TooltipHint>
      </motion.div> : <motion.div key="actions" className="flex h-8 items-center gap-2.5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced || keyboard ? 0 : 0.15, ease: EASE_OUT }}>
        <h1 className="min-w-0 flex-1 text-sm font-semibold">{t("resources.skills")}</h1>
        <TooltipHint content={t("resources.refresh")}><ResourceIconButton aria-label={t("resources.refresh")} onClick={onRefresh} disabled={loading}><RefreshCwIcon className={cn(loading && "animate-spin motion-reduce:animate-none")} /></ResourceIconButton></TooltipHint>
        <TooltipHint content={t("resources.search")}><ResourceIconButton ref={trigger} aria-label={t("resources.search")} onClick={() => setSearching(true)}><SearchIcon /></ResourceIconButton></TooltipHint>
        <TooltipHint content={t("resources.upload")}><ResourceIconButton aria-label={t("resources.upload")} onClick={onUpload}><UploadIcon /></ResourceIconButton></TooltipHint>
      </motion.div>}
    </AnimatePresence>
  </div>
}
