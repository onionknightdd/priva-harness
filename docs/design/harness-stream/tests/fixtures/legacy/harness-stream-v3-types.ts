type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

type Id = string

type Sequence = number

type StreamError = {
  code: string
  message: string
  details: JsonValue
}

type Timing = {
  startedAt: number | null
  endedAt: number | null
  durationMs: number | null
  basis: "native_reported"
} | {
  startedAt: number
  endedAt: null
  durationMs: null
  basis: "host_observed"
} | {
  startedAt: number
  endedAt: number
  durationMs: number
  basis: "host_observed"
} | {
  startedAt: number | null
  endedAt: number | null
  durationMs: null
  basis: "unknown"
}

type NativeSource = {
  harness: "codex" | "claude" | "pi"
  interface: string
  version: string | null
  instanceId: string
  channel: string
}

type NativeRecord = {
  source: NativeSource
  format: "json"
  value: JsonValue
} | {
  source: NativeSource
  format: "bytes"
  encoding: "base64"
  value: string
}

type IntegrityIssue = {
  code: "capture_lost" | "encoding_failed" | "storage_failed" | "source_unavailable"
  message: string
  atSeq: number | null
  source: NativeSource | null
}

type IncompleteIntegrity = {
  status: "incomplete"
  issues: Array<IntegrityIssue>
}

type Integrity = {
  status: "complete"
  issues: []
} | IncompleteIntegrity

type BinaryData = {
  kind: "inline"
  encoding: "base64"
  data: string
} | {
  kind: "reference"
  uri: string
  sha256: string
  sizeBytes: number
}

type Content = {
  kind: "text"
  text: string
} | {
  kind: "json"
  value: JsonValue
} | {
  kind: "image" | "file" | "audio" | "video"
  mediaType: string
  name: string | null
  blob: BinaryData
}

type ToolInput = {
  status: "streaming" | "invalid"
  text: string
  value: null
} | {
  status: "complete"
  text: string
  value: JsonValue
}

type MessageItem = {
  id: string
  runId: string | null
  kind: "message"
  role: "user" | "assistant" | "system"
  phase: "input" | "commentary" | "final" | "notification"
  status: "streaming" | "complete" | "failed" | "cancelled"
  content: Array<Content>
}

type ThinkingItem = {
  id: string
  runId: string | null
  kind: "thinking"
  status: "running" | "complete" | "failed" | "cancelled"
  summary: string | null
  timing: Timing
}

type ToolItem = {
  id: string
  runId: string | null
  kind: "tool"
  name: string
  status: "pending" | "running" | "complete" | "failed" | "cancelled"
  input: ToolInput
  output: Array<Content>
  children: Array<OutputItem>
  timing: Timing
  error: StreamError | null
}

type AgentItem = {
  id: string
  runId: string | null
  kind: "agent"
  name: string
  originRunId: string | null
  completionPolicy: "joined" | "detached"
  status: "pending" | "running" | "waiting" | "complete" | "failed" | "cancelled" | "unknown"
  children: Array<OutputItem>
  timing: Timing
  error: StreamError | null
}

type TaskItem = {
  id: string
  runId: string | null
  kind: "task"
  title: string
  taskKind: "command" | "agent" | "workflow" | "monitor" | "other"
  originRunId: string | null
  completionPolicy: "joined" | "detached"
  status: "pending" | "running" | "paused" | "complete" | "failed" | "cancelled" | "unknown"
  control: "api" | "terminal" | "none"
  children: Array<OutputItem>
  timing: Timing
  error: StreamError | null
}

type PlanStep = {
  id: string
  text: string
  status: "pending" | "running" | "complete" | "skipped" | "failed"
}

type PlanItem = {
  id: string
  runId: string | null
  kind: "plan"
  steps: Array<PlanStep>
}

type InteractionChoice = {
  id: string
  label: string
  value: JsonValue
}

type InteractionItem = {
  id: string
  runId: string | null
  kind: "interaction"
  requestId: string
  requestKind: "approval" | "question" | "form" | "authentication"
  status: "pending" | "resolved" | "cancelled"
  prompt: string
  inputSchema: { [key: string]: JsonValue }
  choices: Array<InteractionChoice>
  response: JsonValue
}

type NoticeItem = {
  id: string
  runId: string | null
  kind: "notice"
  severity: "info" | "warning" | "error"
  code: string
  text: string
  details: JsonValue
}

type UsageValues = {
  inputTokens: number | null
  outputTokens: number | null
  thinkingTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  totalTokens: number | null
  cost: {
    amount: string
    currency: string
  } | null
}

type UsageItem = {
  id: string
  runId: string | null
  kind: "usage"
  scope: "call" | "run" | "session"
  mode: "delta" | "cumulative"
  model: string | null
  values: UsageValues
}

type RunItem = {
  id: string
  runId: string
  kind: "run"
  status: "queued" | "running" | "input_required" | "auth_required" | "complete" | "failed" | "cancelled" | "rejected"
  model: string | null
  timing: Timing
  error: StreamError | null
}

type OutputItem = MessageItem | ThinkingItem | ToolItem | AgentItem | TaskItem | PlanItem | InteractionItem | NoticeItem | UsageItem | RunItem

type OutputEdit = {
  index: number
  deleteCount: number
  items: Array<OutputItem>
}

type Projection = {
  status: "applied"
  edits: Array<OutputEdit>
} | {
  status: "unmapped"
  edits: []
} | {
  status: "failed"
  edits: []
  error: StreamError
}

type Context = {
  sessionId: string
  runId: string | null
}

type EventFrame = {
  v: 3
  kind: "event"
  streamId: string
  seq: number
  ts: number
  context: Context
  native: NativeRecord | null
  integrity: Integrity
  output: Projection
}

type SnapshotFrame = {
  v: 3
  kind: "snapshot"
  streamId: string
  atSeq: number
  ts: number
  sessionId: string
  sources: Array<NativeSource>
  integrity: Integrity
  items: Array<OutputItem>
}

type ReplyFrame = {
  v: 3
  kind: "reply"
  requestId: string
  command: "submit"
  ok: true
  result: {
    sessionId: string
    runId: string
    streamId: string
  }
} | {
  v: 3
  kind: "reply"
  requestId: string
  command: "subscribe"
  ok: true
  result: {
    streamId: string
    atSeq: number
  }
} | {
  v: 3
  kind: "reply"
  requestId: string
  command: "cancel"
  ok: true
  result: {
    runId: string
    accepted: boolean
  }
} | {
  v: 3
  kind: "reply"
  requestId: string
  command: "respond"
  ok: true
  result: {
    interactionId: string
    accepted: boolean
  }
} | {
  v: 3
  kind: "reply"
  requestId: string
  command: "submit" | "subscribe" | "cancel" | "respond"
  ok: false
  error: StreamError
}

type ControlFrame = {
  v: 3
  kind: "control"
  streamId: string
  code: "replay.unavailable"
  details: {
    requestedAfterSeq: number
    availableFromSeq: number | null
    latestSeq: number | null
    reason: "expired" | "unknown_stream" | "invalid_cursor"
  }
} | {
  v: 3
  kind: "control"
  streamId: string
  code: "stream.incomplete"
  details: {
    integrity: IncompleteIntegrity
  }
} | {
  v: 3
  kind: "control"
  streamId: string
  code: "stream.closed"
  details: {
    atSeq: number
    reason: "export_complete" | "session_closed" | "server_shutdown"
  }
} | {
  v: 3
  kind: "control"
  streamId: string
  code: "stream.replaced"
  details: {
    nextStreamId: string
    reason: string
  }
}

type SharedFrame = EventFrame | SnapshotFrame | ReplyFrame | ControlFrame
