import { useSyncExternalStore } from "react"

export type BackgroundTask = {
  taskId: string; kind: "bash" | "agent" | "workflow" | "monitor" | "other"
  status: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled" | "unknown"
  toolUseId?: string; originRunId?: string; description?: string; summary?: string
  result?: string | null; tokens?: number; durationMs?: number
  outputFile?: string; updatedAt?: number; stopRequested?: boolean
}
export type TaskNotification = { id: string; task: BackgroundTask; createdAt?: string; turnId?: string }
export type TaskReplyTarget = { notificationIds: string[]; taskId: string; toolUseId?: string; turnId?: string }
export const taskIsActive = (task: BackgroundTask) => ["pending", "running", "paused"].includes(task.status)
const empty: readonly BackgroundTask[] = []
const sessions = new Map<string, readonly BackgroundTask[]>()
const listeners = new Set<() => void>()
const stoppers = new Map<string, (id: string) => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function setBackgroundTasks(key: string, tasks: readonly BackgroundTask[]) {
  sessions.set(key, tasks)
  for (const listener of listeners) listener()
}
/** Polling supplies sidebar overviews; a subscribed session is owned by its event stream. */
export function syncBackgroundOverview(harness: string, entries: readonly { sessionId: string; tasks: readonly BackgroundTask[] }[]) {
  const keys = new Set(entries.map((entry) => `${harness}:${entry.sessionId}`))
  for (const key of sessions.keys()) {
    if (key.startsWith(`${harness}:`) && !keys.has(key) && !stoppers.has(key)) setBackgroundTasks(key, [])
  }
  for (const entry of entries) {
    const key = `${harness}:${entry.sessionId}`
    if (!stoppers.has(key)) setBackgroundTasks(key, entry.tasks)
  }
}
export function updateBackgroundTask(key: string, task: BackgroundTask) {
  const current = sessions.get(key) ?? empty
  const previous = current.find((item) => item.taskId === task.taskId)
  const next = { ...previous, ...task }
  setBackgroundTasks(key, [...current.filter((item) => item.taskId !== task.taskId), next])
}
export function bindTaskStop(key: string, stop: (id: string) => void) {
  stoppers.set(key, stop)
  return () => { if (stoppers.get(key) === stop) stoppers.delete(key) }
}
export function useBackgroundTasks(key: string) {
  return useSyncExternalStore(subscribe, () => sessions.get(key) ?? empty)
}
export function stopBackgroundTask(key: string, id: string) { stoppers.get(key)?.(id) }
