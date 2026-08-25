const SESSION_API_PREFIX = "/api/sandbox/agent/sessions"

export type AgentRunHarness = "claude" | "pi"

export type SessionRunMode = "agent" | "code"

export type SessionInfo = {
  sessionId: string
  summary: string
  lastModified: number
  customTitle: string | null
  firstPrompt: string | null
  cwd: string | null
  tag: string | null
  tags: string[]
  tagColors: Record<string, number>
  pinned: boolean
  archived: boolean
  runMode: SessionRunMode
}

export type SessionProjectGroup = {
  cwd: string
  pinned: boolean
  sessions: SessionInfo[]
  hasMore: boolean
}

export type GroupedSessionList = {
  groups: SessionProjectGroup[]
  activeCwd: string
}

export class SandboxSessionsApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "SandboxSessionsApiError"
    this.status = status
  }
}

type ErrorResponse = {
  detail?: string
}

type SessionInfoResponse = {
  session_id: string
  summary: string
  last_modified: number
  custom_title: string | null
  first_prompt: string | null
  cwd: string | null
  tag: string | null
  tags: string[]
  tag_colors: Record<string, number>
  pinned: boolean
  archived: boolean
  run_mode: SessionRunMode
}

type GroupedSessionListResponse = {
  groups: Array<{
    cwd: string
    pinned: boolean
    sessions: SessionInfoResponse[]
    has_more: boolean
  }>
  active_cwd: string
}

type FlatSessionListResponse = {
  cwd: string
  sessions: SessionInfoResponse[]
  total: number
  limit: number
  offset: number
}

function harnessQuery(harness: AgentRunHarness, extra?: Record<string, string>) {
  return new URLSearchParams({ harness, ...extra })
}

function sessionPath(sessionId: string, suffix = "") {
  return `${SESSION_API_PREFIX}/${encodeURIComponent(sessionId)}${suffix}`
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: "no-store", ...init })

  if (!response.ok) {
    let detail = response.statusText || `HTTP ${response.status}`

    try {
      const error = (await response.json()) as ErrorResponse
      if (error.detail) {
        detail = error.detail
      }
    } catch {
      // Keep the HTTP status text when the response has no JSON body.
    }

    throw new SandboxSessionsApiError(response.status, detail)
  }

  return (await response.json()) as T
}

function mapSession(session: SessionInfoResponse): SessionInfo {
  return {
    sessionId: session.session_id,
    summary: session.summary ?? "",
    lastModified: session.last_modified,
    customTitle: session.custom_title,
    firstPrompt: session.first_prompt,
    cwd: session.cwd,
    tag: session.tag,
    tags: session.tags ?? [],
    tagColors: session.tag_colors ?? {},
    pinned: Boolean(session.pinned),
    archived: Boolean(session.archived),
    runMode: session.run_mode ?? "agent",
  }
}

export function listGroupedSessions(
  harness: AgentRunHarness,
  signal?: AbortSignal
) {
  return requestJson<GroupedSessionListResponse>(
    `${SESSION_API_PREFIX}?${harnessQuery(harness)}`,
    { signal }
  ).then((payload) => ({
    activeCwd: payload.active_cwd,
    groups: payload.groups.map((group) => ({
      cwd: group.cwd,
      pinned: group.pinned,
      hasMore: group.has_more,
      sessions: group.sessions.map(mapSession),
    })),
  }))
}

export function listSessionsForCwd(
  harness: AgentRunHarness,
  cwd: string,
  options?: { limit?: number; offset?: number; signal?: AbortSignal }
) {
  const query = harnessQuery(harness, { cwd })
  if (options?.limit !== undefined) {
    query.set("limit", String(options.limit))
  }
  if (options?.offset !== undefined) {
    query.set("offset", String(options.offset))
  }

  return requestJson<FlatSessionListResponse>(
    `${SESSION_API_PREFIX}?${query}`,
    { signal: options?.signal }
  ).then((payload) => ({
    cwd: payload.cwd,
    total: payload.total,
    sessions: payload.sessions.map(mapSession),
  }))
}

export function renameSession(
  harness: AgentRunHarness,
  sessionId: string,
  title: string
) {
  return requestJson<{ status: "ok" }>(
    `${sessionPath(sessionId)}?${harnessQuery(harness)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }
  )
}

export function deleteSession(harness: AgentRunHarness, sessionId: string) {
  return requestJson<{ status: "ok" }>(
    `${sessionPath(sessionId)}?${harnessQuery(harness)}`,
    { method: "DELETE" }
  )
}

export function pinSession(
  harness: AgentRunHarness,
  sessionId: string,
  pinned: boolean
) {
  return requestJson<{ status: "ok"; pinned: boolean; archived: boolean }>(
    `${sessionPath(sessionId, "/pin")}?${harnessQuery(harness)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    }
  )
}

export function archiveSession(
  harness: AgentRunHarness,
  sessionId: string,
  archived: boolean
) {
  return requestJson<{ status: "ok"; pinned: boolean; archived: boolean }>(
    `${sessionPath(sessionId, "/archive")}?${harnessQuery(harness)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    }
  )
}

export function tagSession(
  harness: AgentRunHarness,
  sessionId: string,
  tags: string[]
) {
  return requestJson<{
    status: "ok"
    tags: string[]
    tag_colors: Record<string, number>
  }>(`${sessionPath(sessionId, "/tag")}?${harnessQuery(harness)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tags }),
  })
}

export function listSessionThread(
  harness: AgentRunHarness,
  sessionId: string,
  signal?: AbortSignal
) {
  return requestJson<{
    messages: Array<{
      id: string
      role: "user" | "assistant"
      content: string
      created_at: string
      status: "streaming" | "complete" | "error"
      transcript_uuid: string | null
      blocks?: unknown
      nested_agents?: unknown
      workflows?: unknown
    }>
    add_dirs: string[]
    run_mode: SessionRunMode
    live_run_id: string | null
  }>(`${sessionPath(sessionId, "/thread")}?${harnessQuery(harness)}`, {
    signal,
  }).then((payload) => ({
    addDirs: payload.add_dirs,
    runMode: payload.run_mode,
    liveRunId: payload.live_run_id,
    messages: payload.messages.map((item) => ({
      id: item.id,
      role: item.role,
      content: item.content,
      createdAt: item.created_at,
      status: item.status,
      ...(item.transcript_uuid ? { transcriptUuid: item.transcript_uuid } : {}),
      ...(item.blocks === undefined ? {} : { blocks: item.blocks }),
      ...(item.nested_agents === undefined
        ? {}
        : { nestedAgents: mapNestedAgents(item.nested_agents) }),
      ...(item.workflows === undefined
        ? {}
        : { workflows: mapWorkflows(item.workflows) }),
    })),
  }))
}

function mapNestedAgents(raw: unknown) {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.flatMap((item) => {
    if (typeof item !== "object" || item === null) {
      return []
    }
    const record = item as Record<string, unknown>
    const parentToolUseId =
      typeof record.parent_tool_use_id === "string"
        ? record.parent_tool_use_id
        : typeof record.parentToolUseId === "string"
          ? record.parentToolUseId
          : ""
    if (parentToolUseId === "") {
      return []
    }
    return [
      {
        parentToolUseId,
        status: record.status === "completed" ? "completed" as const : "running" as const,
        blocks: Array.isArray(record.blocks) ? record.blocks : [],
        inbox: Array.isArray(record.inbox) ? record.inbox.map(mapInbox) : [],
        ...(typeof record.agent_id === "string"
          ? { agentId: record.agent_id }
          : typeof record.agentId === "string"
            ? { agentId: record.agentId }
            : {}),
        ...(typeof record.name === "string" ? { name: record.name } : {}),
      },
    ]
  })
}

function mapInbox(raw: unknown) {
  if (typeof raw !== "object" || raw === null) {
    return { body: "", source: "peer" as const }
  }
  const record = raw as Record<string, unknown>
  const body = typeof record.body === "string" ? record.body : ""
  const source = record.source === "coordinator" ? "coordinator" as const : "peer" as const
  const senderName =
    typeof record.sender_name === "string"
      ? record.sender_name
      : typeof record.senderName === "string"
        ? record.senderName
        : undefined
  return {
    body,
    source,
    ...(senderName === undefined ? {} : { senderName }),
  }
}

function mapWorkflows(raw: unknown) {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.flatMap((item) => {
    if (typeof item !== "object" || item === null) {
      return []
    }
    const record = item as Record<string, unknown>
    const workflowToolUseId =
      typeof record.workflow_tool_use_id === "string"
        ? record.workflow_tool_use_id
        : typeof record.workflowToolUseId === "string"
          ? record.workflowToolUseId
          : ""
    if (workflowToolUseId === "") {
      return []
    }
    return [
      {
        workflowToolUseId,
        status: typeof record.status === "string" ? record.status : "running",
        ...(typeof record.name === "string" ? { name: record.name } : {}),
        ...(typeof record.summary === "string" ? { summary: record.summary } : {}),
      },
    ]
  })
}

export function forkSession(
  harness: AgentRunHarness,
  sessionId: string,
  body: { stem: string; upToMessageId?: string }
) {
  return requestJson<SessionInfoResponse>(
    `${sessionPath(sessionId, "/fork")}?${harnessQuery(harness)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stem: body.stem,
        ...(body.upToMessageId === undefined
          ? {}
          : { up_to_message_id: body.upToMessageId }),
      }),
    }
  ).then(mapSession)
}
