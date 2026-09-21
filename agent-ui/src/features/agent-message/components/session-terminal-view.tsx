import * as React from "react"
import { useTranslation } from "react-i18next"
import { useTheme } from "next-themes"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { LoaderCircleIcon, RotateCcwIcon } from "lucide-react"
import { FitAddon } from "@xterm/addon-fit"
import { WebglAddon } from "@xterm/addon-webgl"
import { Terminal, type ITheme } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { RunHarnessId } from "@/features/sidebar/header/harness-options"
import type { AgentRunEffort } from "../run-agent-session"
import {
  connectTerminalSession,
  type TerminalSession,
  type TerminalSessionStatus,
} from "../terminal-session"

// xterm needs concrete colours. Background / foreground follow the neutral
// shadcn palette in index.css (oklch(1 0 0) / oklch(0.145 0 0)); the sixteen
// ANSI slots are full light and dark terminal palettes (GitHub's terminal
// schemes), because xterm's built-in defaults are tuned for dark backgrounds
// and leave yellow, cyan and the bright colours unreadable on white.
const LIGHT_THEME: ITheme = {
  background: "#ffffff",
  foreground: "#0a0a0a",
  cursor: "#0a0a0a",
  cursorAccent: "#ffffff",
  selectionBackground: "#0969da33",
  selectionInactiveBackground: "#0969da1f",
  black: "#24292f",
  red: "#cf222e",
  green: "#116329",
  yellow: "#4d2d00",
  blue: "#0969da",
  magenta: "#8250df",
  cyan: "#1b7c83",
  white: "#6e7781",
  brightBlack: "#57606a",
  brightRed: "#a40e26",
  brightGreen: "#1a7f37",
  brightYellow: "#633c01",
  brightBlue: "#218bff",
  brightMagenta: "#a475f9",
  brightCyan: "#3192aa",
  brightWhite: "#8c959f",
}

const DARK_THEME: ITheme = {
  background: "#0a0a0a",
  foreground: "#fafafa",
  cursor: "#fafafa",
  cursorAccent: "#0a0a0a",
  selectionBackground: "#58a6ff4d",
  selectionInactiveBackground: "#58a6ff26",
  black: "#484f58",
  red: "#ff7b72",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39c5cf",
  white: "#b1bac4",
  brightBlack: "#6e7681",
  brightRed: "#ffa198",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d4dd",
  brightWhite: "#f0f6fc",
}

const MOBILE_KEYS = [
  { key: "escape", bytes: "\u001b" },
  { key: "tab", bytes: "\t" },
  { key: "up", bytes: "\u001b[A" },
  { key: "down", bytes: "\u001b[B" },
  { key: "interrupt", bytes: "\u0003" },
] as const

export type SessionTerminalViewProps = {
  harness: RunHarnessId
  cwd: string
  model: string | null
  effort: AgentRunEffort
  sessionId: string | null
  /** Hidden views keep their terminal and socket alive; only the surface is collapsed. */
  hidden: boolean
  /** Called once a terminal opened without a session id has been assigned one by the runner. */
  onSessionReady?: (sessionId: string) => void
}

export function SessionTerminalView({
  harness,
  cwd,
  model,
  effort,
  sessionId,
  hidden,
  onSessionReady,
}: SessionTerminalViewProps) {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const hostRef = React.useRef<HTMLDivElement>(null)
  const terminalRef = React.useRef<Terminal | null>(null)
  const fitRef = React.useRef<FitAddon | null>(null)
  const sessionRef = React.useRef<TerminalSession | null>(null)
  const knownSessionIdRef = React.useRef<string | null>(sessionId)
  const onSessionReadyRef = React.useRef(onSessionReady)
  onSessionReadyRef.current = onSessionReady
  const [status, setStatus] = React.useState<TerminalSessionStatus>({ phase: "connecting" })
  const [size, setSize] = React.useState<{ cols: number; rows: number } | null>(null)
  const [generation, setGeneration] = React.useState(0)

  React.useEffect(() => {
    if (sessionId) knownSessionIdRef.current = sessionId
  }, [sessionId])

  // One xterm instance for the component lifetime; reconnects reset it in place.
  React.useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-code").trim() || "monospace",
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: resolvedTheme === "dark" ? DARK_THEME : LIGHT_THEME,
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host)
    let webgl: WebglAddon | null = null
    try {
      webgl = new WebglAddon()
      webgl.onContextLoss(() => { webgl?.dispose(); webgl = null })
      terminal.loadAddon(webgl)
    } catch {
      // The DOM renderer is the fallback when WebGL is unavailable.
    }
    // The code font is loaded asynchronously; glyphs rasterised before it
    // arrives would otherwise stay cached with the fallback metrics.
    let fontsSettled = false
    void document.fonts.ready.then(() => {
      if (fontsSettled) return
      fontsSettled = true
      webgl?.clearTextureAtlas()
      if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit()
    })
    terminalRef.current = terminal
    fitRef.current = fit
    const dataDisposable = terminal.onData((data) => sessionRef.current?.send(data))
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      setSize({ cols, rows })
      sessionRef.current?.resize(cols, rows)
    })
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit()
      })
    })
    observer.observe(host)
    return () => {
      fontsSettled = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      dataDisposable.dispose()
      resizeDisposable.dispose()
      sessionRef.current?.close()
      sessionRef.current = null
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
    }
    // The theme is applied through `terminal.options` below; recreating the
    // terminal on theme change would drop the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    const terminal = terminalRef.current
    if (terminal) terminal.options.theme = resolvedTheme === "dark" ? DARK_THEME : LIGHT_THEME
  }, [resolvedTheme])

  // Connect (and reconnect when `generation` advances). The socket outlives
  // renders; only an explicit reopen or unmount closes it.
  React.useEffect(() => {
    const terminal = terminalRef.current
    const fit = fitRef.current
    if (!terminal || !fit || !model || !cwd.trim()) return
    if (hostRef.current && hostRef.current.clientWidth > 0) fit.fit()
    terminal.reset()
    const session = connectTerminalSession(
      {
        harness,
        cwd: cwd.trim(),
        model,
        effort,
        sessionId: knownSessionIdRef.current,
        cols: terminal.cols,
        rows: terminal.rows,
        theme: resolvedTheme === "dark" ? "dark" : "light",
      },
      {
        onOutput: (chunk) => terminal.write(chunk),
        onStatus: (next) => {
          setStatus(next)
          if (next.phase === "ready") {
            const wasNew = knownSessionIdRef.current === null
            knownSessionIdRef.current = next.sessionId
            if (wasNew) onSessionReadyRef.current?.(next.sessionId)
            // Announce the viewer's real size once the runner has attached.
            session.resize(terminal.cols, terminal.rows)
            if (!hidden) terminal.focus()
          }
        },
      }
    )
    sessionRef.current = session
    return () => {
      session.close()
      if (sessionRef.current === session) sessionRef.current = null
    }
    // `hidden` only affects focus and is read at ready time; `resolvedTheme`
    // is read at launch only, a running TUI keeps its theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [harness, cwd, model, effort, generation])

  // Coming back from the chat view: the surface may have been resized while collapsed.
  React.useEffect(() => {
    if (hidden) return
    const frame = requestAnimationFrame(() => {
      fitRef.current?.fit()
      terminalRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [hidden])

  const reconnect = () => setGeneration((value) => value + 1)
  const sendKeys = (bytes: string) => {
    sessionRef.current?.send(bytes)
    terminalRef.current?.focus()
  }
  const overlay = overlayFor(status, Boolean(model))
  const overlayTransition = shouldReduceMotion ? { duration: 0 } : { duration: 0.18, ease: "easeOut" as const }

  return (
    <section
      aria-label={t("agentMessage.terminalView.label")}
      className={cn("flex min-h-0 flex-1 flex-col overflow-hidden pr-2 pb-4 pl-4", hidden && "hidden")}
    >
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-background">
        <div ref={hostRef} className="absolute inset-0 p-2 [&_.xterm]:h-full [&_.xterm-viewport]:rounded-md" />
        <AnimatePresence initial={false}>
          {overlay ? (
            <motion.div
              key={overlay.key}
              role="status"
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80 text-sm text-muted-foreground backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={overlayTransition}
            >
              {overlay.spinner ? (
                <LoaderCircleIcon aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" />
              ) : null}
              <span className="max-w-[80%] text-center">{t(overlay.messageKey, overlay.messageValues)}</span>
              {overlay.detail ? (
                <span className="max-w-[80%] truncate text-center text-xs text-muted-foreground/80">{overlay.detail}</span>
              ) : null}
              {overlay.actionKey ? (
                <Button type="button" variant="outline" size="sm" onClick={reconnect}>
                  <RotateCcwIcon aria-hidden="true" className="size-3.5" />
                  {t(overlay.actionKey)}
                </Button>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-1.5 text-xs text-muted-foreground">
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full",
            status.phase === "ready" ? "bg-status-running" : status.phase === "connecting" ? "bg-status-warm" : "bg-status-idle"
          )}
        />
        <span>
          {status.phase === "ready"
            ? t("agentMessage.terminalView.connected")
            : status.phase === "connecting"
              ? t("agentMessage.terminalView.connecting")
              : t("agentMessage.terminalView.disconnected")}
        </span>
        {size ? <span className="tabular-nums">{t("agentMessage.terminalView.size", size)}</span> : null}
        <div className="ml-auto flex items-center gap-1 md:hidden">
          {MOBILE_KEYS.map((entry) => (
            <Button
              key={entry.key}
              type="button"
              variant="ghost"
              size="xs"
              className="h-6 px-2 font-code text-[11px]"
              onClick={() => sendKeys(entry.bytes)}
            >
              {t(`agentMessage.terminalView.keys.${entry.key}`)}
            </Button>
          ))}
        </div>
      </div>
    </section>
  )
}

type Overlay = {
  key: string
  messageKey: string
  messageValues?: Record<string, string>
  detail?: string
  spinner: boolean
  actionKey?: string
}

function overlayFor(status: TerminalSessionStatus, hasModel: boolean): Overlay | null {
  if (!hasModel) return { key: "no-model", messageKey: "agentMessage.terminalView.connecting", spinner: true }
  switch (status.phase) {
    case "connecting":
      return { key: "connecting", messageKey: "agentMessage.terminalView.starting", spinner: true }
    case "ready":
      return null
    case "exited":
      return { key: "exited", messageKey: "agentMessage.terminalView.exited", detail: status.reason, spinner: false, actionKey: "agentMessage.terminalView.reopen" }
    case "closed":
      return { key: "closed", messageKey: "agentMessage.terminalView.disconnected", spinner: false, actionKey: "agentMessage.terminalView.reconnect" }
    case "error":
      return status.kind === "unsupported"
        ? { key: "unsupported", messageKey: "agentMessage.terminalView.unsupported", spinner: false }
        : { key: "error", messageKey: "agentMessage.terminalView.failed", detail: status.message, spinner: false, actionKey: "agentMessage.terminalView.reconnect" }
  }
}
