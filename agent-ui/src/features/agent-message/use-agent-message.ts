import { updateInteractions, type InteractionRequest, type InteractionResponse } from "./interaction-data"
import * as React from "react"
import { useTranslation } from "react-i18next"
import { useTheme } from "next-themes"
import { useAgentPreferences } from "@/features/settings/agent-preferences-context"
import { useSessionView } from './session-view-context'
import {
  useActiveSession,
  useChatSessionActions,
  useChatThread,
  useLiveSessions,
  useSessionList,
} from "@/features/chat-session"
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
import { applyThreadStreamFrame, mergeSnapshotMessages, type StreamFrame } from "./run-stream-reducer"
import { updatePromptSuggestion, type PromptSuggestion } from "./prompt-suggestion"

export function useAgentMessage() {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const { preserveViewForSession, setView } = useSessionView()
  const { runHarnessId } = useHarness()
  const { queueBehavior, inputSuggestions, setLastModelReference } = useAgentPreferences()
  const { threadMessages, messagesStatus, transcriptEpoch } = useChatThread()
  const { runCwd, runSessionId, runMode } = useActiveSession()
  const { bindRunSession, setRunModePending } = useChatSessionActions()
  const { refresh } = useSessionList()
  const { beginLiveSession, endLiveSession } = useLiveSessions()
  const composerAttachments = useComposerAttachments(runCwd, runHarnessId, runSessionId)
  const { attachments, clear: clearAttachments } = composerAttachments
  const [interactions, setInteractions] = React.useState<InteractionRequest[]>([])
  const [draft, setDraft] = React.useState("")
  const [suggestion, setSuggestion] = React.useState<PromptSuggestion | null>(null)
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
  const nativeConfigRef = React.useRef<string | undefined>(undefined)
  const latestConfigRef = React.useRef<StreamFrame["config"]>(undefined)
  const configurationRequestRef = React.useRef<string | undefined>(undefined)

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
    if (frame.type === 'terminal.focus') { setView('terminal'); return }
    setInteractions((current) => updateInteractions(current, frame))
    const id = frame.sessionId ?? connectionRef.current?.sessionId
    if (id && ["suggestion.prompts", "session.snapshot", "run.started", "session.rebound"].includes(frame.type ?? "")) {
      setSuggestion((current) => updatePromptSuggestion(current, `${runHarnessId}:${id}`, frame))
    }
    if (frame.type === "suggestion.prompts") return
    if (frame.type === 'session.rebound') return
    if (frame.config) {
      const config = frame.config
      latestConfigRef.current = config
      const acknowledged = Boolean(frame.requestId && frame.requestId === configurationRequestRef.current)
      if (acknowledged) configurationRequestRef.current = undefined
      // Keep the latest choice visible while older native confirmations arrive.
      const selection = JSON.stringify([id, config.profileId, config.model, config.effort])
      if (!configurationRequestRef.current && (acknowledged || selection !== nativeConfigRef.current)) {
        nativeConfigRef.current = selection
        if (config.profileId) setModelReference(`${config.profileId}:${config.model}`)
        if (config.effort) setEffort(config.effort)
      }
      setContextUsage(config.context)
      if (id && ((config.cwd && config.cwd !== runCwd) || (config.runMode && config.runMode !== runMode))) bindRunSession(id, { cwd: config.cwd, ...(config.runMode ? { runMode: config.runMode } : {}) })
    }
    if (frame.type === 'session.config') return
    const key = `${runHarnessId}:${id}`
    if (frame.type === "session.snapshot") {
      hasSnapshotRef.current = true
      setMessages((current) => {
        const snapshot = mergeSnapshotMessages(current, frame.messages ?? [])
        const ids = new Set(snapshot.flatMap((message) => [message.id, message.renderId ?? message.id]))
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
      // The terminal owns native transcript IDs. Once it has accepted this
      // command, snapshots replace its optimistic bubbles without duplicates.
      if (frame.driver === "terminal") pendingIdsRef.current.delete(runId)
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
      onRebind: (previous, next) => {
        if (generation !== generationRef.current) return
        preserveViewForSession(next)
        bindRef.current(next, { previousSessionId: previous })
        endLiveSession(previous)
        seedTitleRef.current = null
        hasSnapshotRef.current = true
        setMessages((current) => current.filter((message) => pendingIdsRef.current.has(message.id) || pendingIdsRef.current.has(message.id.replace(/:user$/, ''))))
        setInteractions([])
        setSuggestion(null)
        setContextUsage(emptyContextUsage())
      },
    })
    connectionRef.current = connection
    connectionHarnessRef.current = runHarnessId
    if (runSessionId) unbindStopRef.current = bindTaskStop(`${runHarnessId}:${runSessionId}`, connection.stopTask)
    return connection
  }, [runHarnessId, runSessionId, preserveViewForSession, endLiveSession])

  const resetConnection = React.useCallback(() => {
    generationRef.current++
    contextRequestRef.current++
    connectionRef.current?.disconnect()
    connectionRef.current = null
    unbindStopRef.current?.()
    pendingIdsRef.current.clear()
    hasSnapshotRef.current = false
    nativeConfigRef.current = undefined
    latestConfigRef.current = undefined
    configurationRequestRef.current = undefined
    setConnected(false)
    setInteractions([])
    setActiveRunId(null)
    setSuggestion(null)
  }, [])

  React.useEffect(() => {
    const connection = connectionRef.current
    if (connection && (connectionHarnessRef.current !== runHarnessId ||
      (connection.sessionId ?? null) !== runSessionId)) {
      resetConnection()
      setMessages([])
      setContextUsage(emptyContextUsage())
    }
    // TUI-created sessions already have a server stream, even before their
    // first transcript is saved or an HTTP history load has completed.
    if (runSessionId && runHarnessId && messagesStatus !== "loading") {
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
    if (runHarnessId === "claude") setRunModePending(true)
    pendingIdsRef.current.add(assistant.id)
    seedTitleRef.current = content || files.map((file) => file.name).join(", ")
    setLastModelReference(modelReference)
    setDraft(""); setSlashCommand(null); clearAttachments()
    setSuggestion(null)
    setMessages((current) => [...current, user, assistant])
    const generation = generationRef.current
    // Queue only model turns. Detached tasks have their own lifecycle and stop action.
    const failed = (error: unknown) => {
      if (generation !== generationRef.current) return
      pendingIdsRef.current.delete(assistant.id)
      if (pendingIdsRef.current.size === 0) setRunModePending(false)
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
        ...(runHarnessId === "claude" ? { runMode } : {}),
        cwd: runCwd.trim(), effort, promptSuggestions: inputSuggestions,
        theme: resolvedTheme === "dark" ? "dark" : "light" }, assistant.id).catch(failed)
    }).catch(failed)
  }, [interactions.length, attachments, slashCommand, draft, modelReference, runHarnessId, runCwd, ensureConnection, setLastModelReference, clearAttachments, queueBehavior, effort, inputSuggestions, resolvedTheme, runMode, setRunModePending, t])

  const respondPermission = React.useCallback((response: InteractionResponse) => {
    const connection = connectionRef.current
    return connection ? connection.respondPermission(response) : Promise.reject(new Error("Connection unavailable"))
  }, [])
  const synchronizeSelection = React.useCallback((model: string | null, nextEffort: AgentRunEffort) => {
    if (!model || runHarnessId !== "claude" || !runSessionId) return
    const requestId = crypto.randomUUID(), generation = generationRef.current
    configurationRequestRef.current = requestId
    setConnectionError(null)
    void ensureConnection().configure({ model, cwd: runCwd, effort: nextEffort, promptSuggestions: inputSuggestions }, requestId).catch((error: unknown) => {
      if (generation !== generationRef.current || configurationRequestRef.current !== requestId) return
      configurationRequestRef.current = undefined
      const native = latestConfigRef.current
      if (native?.profileId) setModelReference(`${native.profileId}:${native.model}`)
      if (native?.effort) setEffort(native.effort)
      setConnectionError(error instanceof Error ? error.message : String(error))
    })
  }, [runHarnessId, runSessionId, runCwd, inputSuggestions, ensureConnection])
  const changeModelReference = React.useCallback((model: string | null, source?: "user") => {
    setModelReference(model)
    if (source === "user") synchronizeSelection(model, effort)
  }, [effort, synchronizeSelection])
  const changeEffort = React.useCallback((next: AgentRunEffort) => {
    setEffort(next)
    synchronizeSelection(modelReference, next)
  }, [modelReference, synchronizeSelection])
  const stop = React.useCallback(() => connectionRef.current?.abort(), [])
  const dismissPromptSuggestion = React.useCallback(() => setSuggestion((current) =>
    current && !current.dismissed ? { ...current, dismissed: true } : current), [])
  const updateDraft = React.useCallback((value: string) => {
    setDraft(value)
    dismissPromptSuggestion()
  }, [dismissPromptSuggestion])
  const isStreaming = activeRunId !== null || messages.some((message) => message.status === "streaming")
  return {
    interactions, respondPermission, composerAttachments, draft, messages, contextUsage, modelReference, effort, isConnected, connectionError,
    isStreaming,
    promptSuggestion: inputSuggestions && isConnected && !isStreaming && suggestion?.scope === `${runHarnessId}:${runSessionId}` && !suggestion.dismissed ? suggestion.text : undefined,
    dismissPromptSuggestion,
    canSubmit: Boolean(!interactions.length && (draft.trim() || slashCommand || attachments.length) && readyComposerAttachments(attachments) !== null && modelReference && runHarnessId && runCwd.trim()),
    modelReady: Boolean(modelReference && runHarnessId), slashCommand, setDraft: updateDraft, setSlashCommand,
    setModelReference: changeModelReference, setEffort: changeEffort, submit, stop,
  }
}
