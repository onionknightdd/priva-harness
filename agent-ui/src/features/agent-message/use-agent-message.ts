import { updateInteractions, type InteractionRequest, type InteractionResponse } from "./interaction-data"
import * as React from "react"
import { useTranslation } from "react-i18next"
import { useAgentPreferences } from "@/features/settings/agent-preferences-context"
import { useChatSession, useLiveSessions } from "@/features/chat-session"
import { useHarness } from "@/features/sidebar/header/harness-context"
import { fetchSessionContextUsage } from "@/lib/api/sandbox-sessions"
import type { SlashCommand } from "@/lib/api/slash-commands"
import { createAgentThreadMessage, type AgentThreadMessage } from "./agent-message-data"
import { composeSlashMessage } from "./composer-slash-command"
import { readyComposerAttachments } from "./composer-attachments"
import { useComposerAttachments } from "./use-composer-attachments"
import { connectAgentSession, type AgentSessionConnection, type AgentRunEffort } from "./run-agent-session"
import { bindTaskStop, setBackgroundTasks, updateBackgroundTask } from "./background-task-store"
import { isCompactCommandUserMessage } from "./slash-command-envelope"
import { contextUsageFromApi, emptyContextUsage, type ContextUsage } from "./context-usage"
import { applyThreadStreamFrame, type StreamFrame } from "./run-stream-reducer"

export function useAgentMessage() {
  const { t } = useTranslation()
  const { runHarnessId } = useHarness()
  const { queueBehavior, inputSuggestions, setLastModelReference } = useAgentPreferences()
  const { threadMessages, messagesStatus, transcriptEpoch, runCwd, runSessionId, bindRunSession, refresh } = useChatSession()
  const { beginLiveSession, endLiveSession } = useLiveSessions()
  const composerAttachments = useComposerAttachments(runCwd, runHarnessId, runSessionId)
  const { attachments, clear: clearAttachments } = composerAttachments
  const [interactions, setInteractions] = React.useState<InteractionRequest[]>([])
  const [draft, setDraft] = React.useState("")
  const [slashCommand, setSlashCommand] = React.useState<SlashCommand | null>(null)
  const [modelReference, setModelReference] = React.useState<string | null>(null)
  const [effort, setEffort] = React.useState<AgentRunEffort>("medium")
  const [messages, setMessages] = React.useState<AgentThreadMessage[]>([])
  const [connectionError, setConnectionError] = React.useState<string | null>(null)
  const [isConnected, setConnected] = React.useState(false)
  const [activeRunId, setActiveRunId] = React.useState<string | null>(null)
  const [contextUsage, setContextUsage] = React.useState<ContextUsage>(emptyContextUsage)
  const connectionRef = React.useRef<AgentSessionConnection | null>(null)
  const connectionHarnessRef = React.useRef(runHarnessId)
  const generationRef = React.useRef(0)
  const submitChainRef = React.useRef(Promise.resolve())
  const pendingIdsRef = React.useRef(new Set<string>())
  const seedTitleRef = React.useRef<string | null>(null)
  const unbindStopRef = React.useRef<(() => void) | undefined>(undefined)
  const contextRequestRef = React.useRef(0)
  const hasSnapshotRef = React.useRef(false)

  const refreshContext = React.useCallback((sessionId: string) => {
    if (!runHarnessId) return
    const request = ++contextRequestRef.current
    void fetchSessionContextUsage(runHarnessId, sessionId).then((value) => {
      if (request === contextRequestRef.current) setContextUsage(contextUsageFromApi(value))
    }).catch(() => undefined)
  }, [runHarnessId])

  // Socket handlers retain a live view of React callbacks without reconnecting on each render.
  const receiveRef = React.useRef<(frame: StreamFrame) => void>(() => undefined)
  receiveRef.current = (frame) => {
    setInteractions((current) => updateInteractions(current, frame))
    const id = frame.sessionId ?? connectionRef.current?.sessionId
    const key = `${runHarnessId}:${id}`
    if (frame.type === "session.snapshot") {
      hasSnapshotRef.current = true
      setMessages((current) => {
        const snapshot = frame.messages ?? []
        const ids = new Set(snapshot.map((message) => message.id))
        return [...snapshot, ...current.filter((message) => !ids.has(message.id) &&
          (pendingIdsRef.current.has(message.id) || pendingIdsRef.current.has(message.id.replace(/:user$/, ""))))]
      })
      setActiveRunId(frame.activeRunId ?? null)
      setBackgroundTasks(key, frame.tasks ?? [])
      if (id) {
        if (frame.activeRunId) beginLiveSession(id)
        else endLiveSession(id)
      }
      return
    }
    if (frame.tasks) setBackgroundTasks(key, frame.tasks)
    if (frame.task) updateBackgroundTask(key, frame.task)
    if (frame.type === "run.started" && frame.runId) {
      const runId = frame.runId
      setActiveRunId(runId)
      if (id) beginLiveSession(id)
      setMessages((current) => applyThreadStreamFrame(current, runId, frame))
      return
    }
    if (frame.type === "session.state" || frame.type === "error") return
    setMessages((current) => applyThreadStreamFrame(current, frame.runId ?? "", frame))
    if (["run.completed", "run.failed", "run.aborted"].includes(frame.type ?? "")) {
      if (frame.runId) pendingIdsRef.current.delete(frame.runId)
      setActiveRunId((current) => current === frame.runId ? null : current)
      if (id) { endLiveSession(id); refreshContext(id) }
      refresh()
    }
  }

  const bindRef = React.useRef(bindRunSession)
  bindRef.current = bindRunSession
  const ensureConnection = React.useCallback(() => {
    if (!runHarnessId) throw new Error("Choose an agent harness")
    if (connectionRef.current) return connectionRef.current
    const generation = generationRef.current
    const connection = connectAgentSession({ harness: runHarnessId, ...(runSessionId ? { sessionId: runSessionId } : {}) }, {
      onFrame: (frame) => { if (generation === generationRef.current) receiveRef.current(frame) },
      onConnection: (connected) => { if (generation === generationRef.current) { setConnected(connected); if (connected) setConnectionError(null) } },
      onError: (message) => { if (generation === generationRef.current) setConnectionError(message) },
      onSession: (id) => {
        if (generation !== generationRef.current) return
        bindRef.current(id, seedTitleRef.current ? { firstPrompt: seedTitleRef.current } : undefined)
        unbindStopRef.current?.()
        unbindStopRef.current = bindTaskStop(`${runHarnessId}:${id}`, connection.stopTask)
      },
    })
    connectionRef.current = connection
    connectionHarnessRef.current = runHarnessId
    if (runSessionId) unbindStopRef.current = bindTaskStop(`${runHarnessId}:${runSessionId}`, connection.stopTask)
    return connection
  }, [runHarnessId, runSessionId])

  const resetConnection = React.useCallback(() => {
    generationRef.current++
    contextRequestRef.current++
    connectionRef.current?.disconnect()
    connectionRef.current = null
    unbindStopRef.current?.()
    pendingIdsRef.current.clear()
    hasSnapshotRef.current = false
    setConnected(false)
    setInteractions([])
    setActiveRunId(null)
  }, [])

  React.useEffect(() => {
    const connection = connectionRef.current
    if (connection && (connectionHarnessRef.current !== runHarnessId ||
      (connection.sessionId ?? null) !== runSessionId)) {
      resetConnection()
      setMessages([])
      setContextUsage(emptyContextUsage())
    }
    if (runSessionId && runHarnessId && messagesStatus === "ready" && transcriptEpoch > 0) {
      ensureConnection()
      refreshContext(runSessionId)
    }
  }, [runSessionId, runHarnessId, messagesStatus, transcriptEpoch, ensureConnection, resetConnection, refreshContext])

  React.useEffect(() => {
    if (!hasSnapshotRef.current && pendingIdsRef.current.size === 0) setMessages(messagesStatus === "loading" ? [] : threadMessages)
  }, [threadMessages, messagesStatus, transcriptEpoch])

  React.useEffect(() => () => {
    generationRef.current++
    connectionRef.current?.disconnect()
    unbindStopRef.current?.()
  }, [])

  const submit = React.useCallback(() => {
    const files = readyComposerAttachments(attachments)
    const content = (slashCommand ? composeSlashMessage(slashCommand.name, draft) : draft).trim()
    if (interactions.length || !files || (!content && !files.length) || !modelReference || !runHarnessId || !runCwd.trim()) return
    const connection = ensureConnection()
    const assistant = createAgentThreadMessage("assistant", "", "streaming")
    const user = { ...createAgentThreadMessage("user", content), id: `${assistant.id}:user`,
      ...(files.length ? { attachments: files } : {}),
      ...(!files.length && isCompactCommandUserMessage(content) ? { compact: { phase: "compacting" as const } } : {}) }
    pendingIdsRef.current.add(assistant.id)
    seedTitleRef.current = content || files.map((file) => file.name).join(", ")
    setLastModelReference(modelReference)
    setDraft(""); setSlashCommand(null); clearAttachments()
    setMessages((current) => [...current, user, assistant])
    const generation = generationRef.current
    // Queue only model turns. Detached tasks have their own lifecycle and stop action.
    const failed = (error: unknown) => {
      if (generation !== generationRef.current) return
      pendingIdsRef.current.delete(assistant.id)
      setMessages((current) => current.map((message) => message.id === assistant.id ? {
        ...message, status: "error", content: error instanceof Error ? error.message : t("agentMessage.sendFailed"),
      } : message))
    }
    submitChainRef.current = submitChainRef.current.catch(() => undefined).then(async () => {
      if (generation !== generationRef.current) return
      if (queueBehavior !== "follow-up") {
        if (queueBehavior === "steer") await connection.waitForTools()
        connection.abort()
      }
      await connection.waitForIdle()
      if (generation !== generationRef.current) return
      void connection.start({ text: content, attachments: files, model: modelReference, harness: runHarnessId,
        cwd: runCwd.trim(), effort, promptSuggestions: inputSuggestions }, assistant.id).catch(failed)
    }).catch(failed)
  }, [interactions.length, attachments, slashCommand, draft, modelReference, runHarnessId, runCwd, ensureConnection, setLastModelReference, clearAttachments, queueBehavior, effort, inputSuggestions, t])

  const respondPermission = React.useCallback((response: InteractionResponse) => {
    const connection = connectionRef.current
    return connection ? connection.respondPermission(response) : Promise.reject(new Error("Connection unavailable"))
  }, [])
  const stop = React.useCallback(() => connectionRef.current?.abort(), [])
  return {
    interactions, respondPermission, composerAttachments, draft, messages, contextUsage, modelReference, isConnected, connectionError,
    isStreaming: activeRunId !== null || messages.some((message) => message.status === "streaming"),
    canSubmit: Boolean(!interactions.length && (draft.trim() || slashCommand || attachments.length) && readyComposerAttachments(attachments) !== null && modelReference && runHarnessId && runCwd.trim()),
    modelReady: Boolean(modelReference && runHarnessId), slashCommand, setDraft, setSlashCommand, setModelReference, setEffort, submit, stop,
  }
}
