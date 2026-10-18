import { useEffect, useState } from "react"
import type { TFunction } from "i18next"

import type { AgentThreadMessage } from "./agent-message-data"

export type ProcessElapsedMessage = Pick<AgentThreadMessage, "id" | "createdAt" | "status" | "durationMs">

export function formatRunClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${String(seconds)}s`
  return `${String(minutes)}m ${String(seconds).padStart(2, "0")}s`
}

/** Provider duration wins. Otherwise the clock is the gap from the message start to the last event. */
export function settledRunDuration(
  createdAt: string,
  atMs: number | undefined,
  reported?: number
): number | undefined {
  if (typeof reported === "number" && Number.isFinite(reported) && reported > 0) return reported
  const start = Date.parse(createdAt)
  if (atMs === undefined || !Number.isFinite(start) || start <= 0 || atMs <= start) return undefined
  return atMs - start
}

export function useProcessElapsedLabel(
  message: ProcessElapsedMessage,
  isStreaming: boolean,
  t: TFunction
): string {
  const running = isStreaming && message.status !== "error"
  const start = Date.parse(message.createdAt)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [running, message.id])

  if (running) {
    const ms = Number.isFinite(start) && start > 0 ? Math.max(0, now - start) : 0
    return t("agentMessage.runningFor", { time: formatRunClock(ms) })
  }
  if (message.durationMs !== undefined && message.durationMs > 0) {
    return t("agentMessage.elapsedFor", { time: formatRunClock(message.durationMs) })
  }
  return t("agentMessage.chainOfThought")
}
