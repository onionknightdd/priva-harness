"use client"

import { useEffect, useId, useRef, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { MonitorIcon, RefreshCwIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { useSidebar } from "@/components/ui/sidebar"
import { Spinner } from "@/components/ui/spinner"
import { EASE_OUT } from "@/lib/ease"
import { connectComputer, type ComputerConnectionState } from "../computer-connection"

export function WorkspaceComputerView() {
  const { t } = useTranslation()
  const { isMobile, open, openMobile } = useSidebar()
  const enabled = isMobile ? openMobile : open
  const reducedMotion = Boolean(useReducedMotion())
  const targetRef = useRef<HTMLDivElement>(null)
  const helpId = useId()
  const [state, setState] = useState<ComputerConnectionState>("connecting")
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const target = targetRef.current
    if (!enabled || !target) return
    let disconnect: (() => void) | undefined
    const syncVisibility = () => {
      disconnect?.()
      disconnect = undefined
      if (!document.hidden) disconnect = connectComputer(target, setState)
    }
    syncVisibility()
    document.addEventListener("visibilitychange", syncVisibility)
    return () => {
      document.removeEventListener("visibilitychange", syncVisibility)
      disconnect?.()
    }
  }, [enabled, attempt])

  useEffect(() => {
    const canvas = targetRef.current?.querySelector("canvas")
    canvas?.setAttribute("aria-label", t("workspace.computer.desktop"))
    canvas?.setAttribute("aria-describedby", helpId)
  }, [state, t, helpId])

  const connecting = state === "connecting"

  return (
    <div
      data-workspace-computer
      data-connection-state={state}
      className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
      role="region"
      aria-label={t("workspace.computer.desktop")}
      tabIndex={-1}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape" && event.ctrlKey && event.altKey) {
          event.preventDefault()
          event.stopPropagation()
          // A keyboard user can leave the remote canvas without sending this
          // shortcut to the desktop, then Shift+Tab back to Workspace tabs.
          event.currentTarget.focus()
        }
      }}
    >
      <p id={helpId} className="sr-only">{t("workspace.computer.keyboardHelp")}</p>
      <div
        ref={targetRef}
        className="absolute inset-0 touch-none [&_canvas:focus-visible]:outline-2 [&_canvas:focus-visible]:outline-offset-[-2px] [&_canvas:focus-visible]:outline-ring"
        inert={!enabled || state !== "connected"}
        aria-hidden={state !== "connected"}
      />
      {state !== "connected" && (
        <motion.div
          key={state}
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reducedMotion ? 0 : 0.15, ease: EASE_OUT }}
          className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-background p-5 text-center"
        >
          {connecting
            ? <Spinner aria-hidden className="size-5 text-muted-foreground motion-reduce:animate-none" />
            : <MonitorIcon aria-hidden className="size-6 text-muted-foreground" strokeWidth={1} />}
          <div className="space-y-1" role="status" aria-live="polite">
            <p className="text-sm font-medium">{t(`workspace.computer.${state}`)}</p>
            {!connecting && <p className="text-xs text-muted-foreground">{t(`workspace.computer.${state}Description`)}</p>}
          </div>
          {!connecting && (
            <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>
              <RefreshCwIcon aria-hidden />
              {t("workspace.computer.reconnect")}
            </Button>
          )}
        </motion.div>
      )}
    </div>
  )
}
