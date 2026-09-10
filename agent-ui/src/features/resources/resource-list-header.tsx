import * as React from "react"
import { PlusIcon, RefreshCwIcon, SearchIcon, UploadIcon, XIcon } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { headerSearchMotion } from "@/lib/header-search-motion"
import { cn } from "@/lib/utils"
import { ResourceIconButton } from "./resource-icon-button"
import { TooltipHint } from "@/components/ui/tooltip"
import type { ResourceKind } from "./resource-api"

export function ResourceListHeader({ kind, query, onQueryChange, loading, onRefresh, onCreate }: {
  kind: ResourceKind; query: string; onQueryChange: (query: string) => void; loading: boolean; onRefresh: () => void; onCreate: () => void
}) {
  const { t } = useTranslation()
  const searchLabel = t(kind === "skills" ? "resources.searchSkills" : "resources.searchMcp")
  const createLabel = t(kind === "skills" ? "resources.upload" : "resources.add")
  const [searching, setSearching] = React.useState(false)
  const [keyboard, setKeyboard] = React.useState(false)
  const reduced = useReducedMotion()
  const skipMotion = Boolean(reduced || keyboard)
  const searchMotion = headerSearchMotion(skipMotion)
  const searchIconId = React.useId()
  const input = React.useRef<HTMLInputElement>(null)
  const trigger = React.useRef<HTMLButtonElement>(null)
  const restoreFocus = React.useRef(false)
  React.useEffect(() => {
    if (searching) input.current?.focus()
    else if (restoreFocus.current) { restoreFocus.current = false; trigger.current?.focus() }
  }, [searching])
  const close = (restore: boolean) => { restoreFocus.current = restore; onQueryChange(""); setSearching(false) }
  return <div className="space-y-1" data-skill-list-header={kind === "skills" ? "" : undefined} data-mcp-list-header={kind === "mcp" ? "" : undefined}>
    <div className="flex h-8 w-full items-center gap-2.5" onKeyDownCapture={() => setKeyboard(true)} onPointerDownCapture={() => setKeyboard(false)}>
      <h1 className="shrink-0 text-lg leading-6 font-semibold">{t(`resources.${kind}`)}</h1>
      <motion.div layout transition={searchMotion.transition} className="relative h-8 min-w-0 flex-1">
        <AnimatePresence initial={false} mode="popLayout">
          {searching || query ? <motion.div key="search" layout className="absolute inset-0 z-[1] origin-right" {...searchMotion.input} onBlurCapture={(event) => {
            if (!query && !event.currentTarget.contains(event.relatedTarget)) close(false)
          }}>
            <motion.span layoutId={skipMotion ? undefined : searchIconId} transition={searchMotion.transition} className="pointer-events-none absolute top-1/2 left-2 z-10 flex -translate-y-1/2 text-muted-foreground"><SearchIcon aria-hidden className="size-4" /></motion.span>
            <Input ref={input} value={query} onChange={(event) => onQueryChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(true) } }} aria-label={searchLabel} placeholder={searchLabel} className="h-8 border-0 bg-muted pr-8 pl-8 shadow-none focus-visible:ring-0 dark:bg-muted" />
            <TooltipHint content={t("resources.clearSearch")}><ResourceIconButton className="absolute top-1/2 right-1 -translate-y-1/2" aria-label={t("resources.clearSearch")} onClick={() => close(true)}><XIcon /></ResourceIconButton></TooltipHint>
          </motion.div> : <motion.div key="actions" layout className="absolute inset-0 flex h-8 origin-right items-center justify-end" {...searchMotion.actions}>
            <TooltipHint content={searchLabel}><ResourceIconButton ref={trigger} aria-label={searchLabel} onClick={() => setSearching(true)}><motion.span layoutId={skipMotion ? undefined : searchIconId} className="flex" transition={searchMotion.transition}><SearchIcon aria-hidden className="size-3.5" /></motion.span></ResourceIconButton></TooltipHint>
          </motion.div>}
        </AnimatePresence>
      </motion.div>
      <TooltipHint content={t("resources.refresh")}><ResourceIconButton aria-label={t("resources.refresh")} onClick={onRefresh} disabled={loading}><RefreshCwIcon className={cn(loading && "animate-spin motion-reduce:animate-none")} /></ResourceIconButton></TooltipHint>
      <TooltipHint content={createLabel}><ResourceIconButton aria-label={createLabel} onClick={onCreate}>{kind === "skills" ? <UploadIcon /> : <PlusIcon />}</ResourceIconButton></TooltipHint>
    </div>
    <p className="text-xs leading-5 text-muted-foreground">{t(kind === "skills" ? "resources.skillsHint" : "resources.mcpHint")}</p>
  </div>
}
