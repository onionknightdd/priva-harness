import * as React from "react"
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Transition,
} from "motion/react"
import { FolderSearchIcon, XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const goToTransition: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 34,
  mass: 0.75,
}

export function FileGoToControl({
  onAnnounce,
  onGoTo,
}: {
  onAnnounce: (message: string) => void
  onGoTo: (path: string) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const goToInputRef = React.useRef<HTMLInputElement>(null)
  const goToTriggerRef = React.useRef<HTMLButtonElement>(null)
  const restoreGoToFocusRef = React.useRef(false)
  const [goToPath, setGoToPath] = React.useState("")
  const [goToInvalid, setGoToInvalid] = React.useState(false)
  const [goToPending, setGoToPending] = React.useState(false)
  const [isGoingTo, setIsGoingTo] = React.useState(false)
  const goToIconLayoutId = React.useId()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const transition: Transition = shouldReduceMotion
    ? { duration: 0 }
    : goToTransition

  React.useEffect(() => {
    if (isGoingTo) {
      goToInputRef.current?.focus()
      return
    }

    if (restoreGoToFocusRef.current) {
      restoreGoToFocusRef.current = false
      goToTriggerRef.current?.focus()
    }
  }, [isGoingTo])

  const closeGoTo = (restoreFocus: boolean) => {
    restoreGoToFocusRef.current = restoreFocus
    setGoToPath("")
    setGoToInvalid(false)
    setGoToPending(false)
    setIsGoingTo(false)
  }

  const navigateToDirectory = async () => {
    const path = goToPath.trim()
    if (!path || goToPending) {
      setGoToInvalid(true)
      return
    }

    setGoToPending(true)
    const found = await onGoTo(path)
    setGoToPending(false)

    if (!found) {
      setGoToInvalid(true)
      onAnnounce(t("fileBrowser.goToInvalidPath", { path }))
      return
    }

    closeGoTo(true)
  }

  return (
    <AnimatePresence initial={false} mode="popLayout">
      {isGoingTo ? (
        <motion.form
          key="go-to-input"
          layout
          className="relative h-8 w-1/2 min-w-0 shrink-0 origin-right"
          initial={
            shouldReduceMotion ? false : { opacity: 0, scaleX: 0.94, y: -2 }
          }
          animate={{ opacity: 1, scaleX: 1, y: 0 }}
          exit={
            shouldReduceMotion
              ? { opacity: 0 }
              : { opacity: 0, scaleX: 0.96, y: -1 }
          }
          transition={transition}
          onSubmit={(event) => {
            event.preventDefault()
            void navigateToDirectory()
          }}
          onBlurCapture={(event) => {
            const nextTarget = event.relatedTarget

            if (
              goToPath ||
              (nextTarget instanceof Node &&
                event.currentTarget.contains(nextTarget))
            ) {
              return
            }

            closeGoTo(false)
          }}
        >
          <motion.span
            layoutId={goToIconLayoutId}
            className="pointer-events-none absolute top-1/2 left-2.5 z-10 flex -translate-y-1/2 text-muted-foreground"
            transition={transition}
          >
            <FolderSearchIcon className="size-4" aria-hidden="true" />
          </motion.span>
          <Input
            ref={goToInputRef}
            value={goToPath}
            disabled={goToPending}
            onChange={(event) => {
              setGoToPath(event.target.value)
              setGoToInvalid(false)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void navigateToDirectory()
                return
              }

              if (event.key === "Escape") {
                event.preventDefault()
                closeGoTo(true)
              }
            }}
            aria-label={t("fileBrowser.goTo")}
            aria-invalid={goToInvalid || undefined}
            placeholder={t("fileBrowser.goToPlaceholder")}
            className="h-8 border-0 bg-muted/60 pr-8 pl-8 text-xs shadow-none focus-visible:border-0 focus-visible:ring-0 aria-invalid:bg-destructive/10"
          />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="absolute top-1/2 right-1 z-10 -translate-y-1/2"
                  aria-label={t("fileBrowser.closeGoTo")}
                  onClick={() => closeGoTo(true)}
                />
              }
            >
              <XIcon aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>{t("fileBrowser.closeGoTo")}</TooltipContent>
          </Tooltip>
        </motion.form>
      ) : (
        <motion.div
          key="go-to-trigger"
          layout
          className="shrink-0"
          initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={
            shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9 }
          }
          transition={transition}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  ref={goToTriggerRef}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("fileBrowser.goTo")}
                  onClick={() => setIsGoingTo(true)}
                />
              }
            >
              <motion.span
                layoutId={goToIconLayoutId}
                className="flex"
                transition={transition}
              >
                <FolderSearchIcon aria-hidden="true" />
              </motion.span>
            </TooltipTrigger>
            <TooltipContent>{t("fileBrowser.goTo")}</TooltipContent>
          </Tooltip>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
